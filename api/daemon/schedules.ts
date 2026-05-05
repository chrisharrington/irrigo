import { and, eq, gt, gte, isNull } from 'drizzle-orm';
import {
    grassTypes,
    irrigationCycles,
    scheduleEntries,
    sites,
    soilTypes,
    zones,
} from '@/db/schema';
import type { IrrigationScheduleEntry, Zone } from '@/models';
import { joinedRowToZone, type SelectJoinChain, type ZoneJoinedRow } from './zones';

/**
 * Compact representation of an inserted irrigation cycle, scoped to what the
 * runtime needs to arm timers and update the row on fire/close.
 */
export type PersistedCycle = {
    id: string;
    startTime: Date;
    durationMin: number;
};

/**
 * Per-zone return value from `replaceZoneSchedule`: the inserted cycles in
 * chronological order, ready for the runtime to arm.
 */
export type PersistedScheduleResult = {
    cycles: PersistedCycle[];
};

/**
 * Minimal db interface for `replaceZoneSchedule`. Mirrors Drizzle's `delete()`
 * and `insert().values().returning()` chains so a recording stub can stand in
 * for tests.
 */
export type ScheduleWriterDb = {
    delete: (table: typeof scheduleEntries) => {
        where: (cond: unknown) => Promise<unknown>;
    };
    insert: (table: typeof scheduleEntries | typeof irrigationCycles) => {
        values: (rows: ReadonlyArray<Record<string, unknown>>) => {
            returning: (cols: Record<string, unknown>) => Promise<Array<Record<string, unknown>>>;
        };
    };
};

/**
 * Replaces today's-and-future schedule_entries for a zone with the planner's
 * fresh output, cascading future cycles through the FK delete. Past entries
 * (date < today) are left untouched for history.
 *
 * @param db - Drizzle client (or compatible stub).
 * @param zoneId - The zone whose schedule is being replaced.
 * @param entries - Planner output for the next forecast window.
 * @param today - Local date string in YYYY-MM-DD; entries on this date and
 *   later are deleted before re-insert.
 * @returns The inserted cycles in input order, ready for arming.
 */
export async function replaceZoneSchedule(
    db: ScheduleWriterDb,
    zoneId: string,
    entries: ReadonlyArray<IrrigationScheduleEntry>,
    today: string,
): Promise<PersistedScheduleResult> {
    console.log(`daemon: replacing schedule for zone ${zoneId} from ${today} (${entries.length} entry/entries).`);

    await db
        .delete(scheduleEntries)
        .where(and(eq(scheduleEntries.zoneId, zoneId), gte(scheduleEntries.date, today)));

    const persisted: PersistedCycle[] = [];

    for (const entry of entries) {
        const inserted = await db
            .insert(scheduleEntries)
            .values([
                {
                    zoneId,
                    date: entry.date.format('YYYY-MM-DD'),
                    appliedDepthMm: entry.appliedDepthMm,
                    depletionBeforeMm: entry.depletionBeforeMm,
                    depletionAfterMm: entry.depletionAfterMm,
                },
            ])
            .returning({ id: scheduleEntries.id });

        const entryId = (inserted[0] as { id: string } | undefined)?.id;
        if (!entryId) {
            console.warn(`daemon: schedule_entries insert returned no id for zone ${zoneId} on ${entry.date.format('YYYY-MM-DD')}; skipping cycles.`);
            continue;
        }

        if (entry.cycles.length === 0) continue;

        const cycleRows = entry.cycles.map(cycle => ({
            scheduleEntryId: entryId,
            startTime: cycle.startTime.toDate(),
            durationMin: cycle.durationMin,
        }));

        const insertedCycles = await db
            .insert(irrigationCycles)
            .values(cycleRows)
            .returning({
                id: irrigationCycles.id,
                startTime: irrigationCycles.startTime,
                durationMin: irrigationCycles.durationMin,
            });

        for (const row of insertedCycles) {
            persisted.push({
                id: row['id'] as string,
                startTime: row['startTime'] as Date,
                durationMin: row['durationMin'] as number,
            });
        }
    }

    return { cycles: persisted };
}

/**
 * Joined row produced by the future-cycles query. Carries every column needed
 * to rebuild a `Zone` plus the cycle's own runtime fields.
 */
export type FutureCycleJoinedRow = {
    cycle: typeof irrigationCycles.$inferSelect;
    scheduleEntry: typeof scheduleEntries.$inferSelect;
} & ZoneJoinedRow;

/**
 * Pair returned by `loadFutureCycles`: a runtime-ready cycle plus the fully-
 * formed zone it belongs to.
 */
export type FutureCyclePair = {
    cycle: PersistedCycle;
    zone: Zone;
};

/**
 * Minimal db interface for `loadFutureCycles`. Mirrors the chained Drizzle
 * select-with-joins query.
 */
export type FutureCyclesDb = {
    select: (columns: {
        cycle: typeof irrigationCycles;
        scheduleEntry: typeof scheduleEntries;
        zone: typeof zones;
        grassType: typeof grassTypes;
        soilType: typeof soilTypes;
        site: typeof sites;
    }) => {
        from: (table: typeof irrigationCycles) => SelectJoinChain<FutureCycleJoinedRow>;
    };
};

/**
 * Reads every cycle that hasn't fired yet and whose `start_time` is still in
 * the future, paired with the fully-formed enabled zone it belongs to. Used at
 * daemon startup to arm timers for cycles that survived a previous run.
 *
 * @param db - Drizzle client (or compatible stub).
 * @param now - Reference time. Cycles with `start_time > now` are returned.
 * @returns Pairs of (cycle, zone) ready for the runtime to arm.
 */
export async function loadFutureCycles(db: FutureCyclesDb, now: Date): Promise<FutureCyclePair[]> {
    const rows = await db
        .select({
            cycle: irrigationCycles,
            scheduleEntry: scheduleEntries,
            zone: zones,
            grassType: grassTypes,
            soilType: soilTypes,
            site: sites,
        })
        .from(irrigationCycles)
        .innerJoin(scheduleEntries, eq(irrigationCycles.scheduleEntryId, scheduleEntries.id))
        .innerJoin(zones, eq(scheduleEntries.zoneId, zones.id))
        .innerJoin(grassTypes, eq(zones.grassTypeId, grassTypes.id))
        .innerJoin(soilTypes, eq(zones.soilTypeId, soilTypes.id))
        .innerJoin(sites, eq(zones.siteId, sites.id))
        .where(
            and(
                isNull(irrigationCycles.firedAt),
                gt(irrigationCycles.startTime, now),
                eq(zones.isEnabled, true),
            ),
        );

    const pairs = rows.map(row => mapFutureCycleRow(row));
    console.log(`daemon: loaded ${pairs.length} future cycle(s).`);
    return pairs;
}

function mapFutureCycleRow(row: FutureCycleJoinedRow): FutureCyclePair {
    return {
        cycle: {
            id: row.cycle.id,
            startTime: row.cycle.startTime,
            durationMin: row.cycle.durationMin,
        },
        zone: joinedRowToZone({
            zone: row.zone,
            grassType: row.grassType,
            soilType: row.soilType,
            site: row.site,
        }),
    };
}
