import type dayjs from 'dayjs';
import { and, asc, eq, gt, gte, isNotNull, isNull } from 'drizzle-orm';
import type { Database } from '@/db';
import {
    grassTypes,
    irrigationCycles,
    scheduleEntries,
    sites,
    soilTypes,
    zones,
} from '@/db/schema';
import type { IrrigationScheduleEntry } from '@/models';
import type { FutureCyclePair, PersistedCycle } from '@/models/cycle';
import { joinedRowToZone, type ZoneJoinedRow } from '@/repositories/zones';

/**
 * Joined row produced by the future-cycles query. Internal — services consume
 * the mapped `FutureCyclePair` shape from `@/models/cycle`.
 */
type FutureCycleJoinedRow = {
    cycle: typeof irrigationCycles.$inferSelect;
    scheduleEntry: typeof scheduleEntries.$inferSelect;
} & ZoneJoinedRow;

/**
 * Per-zone return value from `replaceForZone`.
 */
export type ReplaceForZoneResult = {
    cycles: PersistedCycle[];
};

/**
 * Shape of one row from the schedules-list / tonight join — `scheduleEntries
 * × zones × leftJoin irrigationCycles`. Each row is one (entry, cycle) pair;
 * `cycle` is `null` for entries whose cycles haven't been inserted yet (or
 * for non-scheduled sources like `manual`, though this method filters those out).
 */
export type NextRunJoinedRow = {
    entry: typeof scheduleEntries.$inferSelect;
    cycle: typeof irrigationCycles.$inferSelect | null;
    zone: { id: string; name: string };
};

/**
 * Domain interface for the `schedule_entries` table and its child
 * `irrigation_cycles` rows. Both the planner's bulk replace and the
 * runtime's per-cycle fire/close UPDATEs live here.
 */
export interface ScheduleEntriesRepository {
    /**
     * Reads every cycle that hasn't fired yet and whose `start_time` is still
     * in the future, paired with the fully-formed enabled zone it belongs to.
     */
    loadFutureCycles(now: Date): Promise<FutureCyclePair[]>;

    /**
     * Reads every cycle that is in flight (firedAt set, closedAt null), paired
     * with the fully-formed zone it belongs to.
     */
    loadInFlightCycles(): Promise<FutureCyclePair[]>;

    /**
     * Replaces today's-and-future schedule_entries for a zone with the
     * planner's fresh output. Pure write — does not touch `current_depletion_mm`.
     */
    replaceForZone(
        zoneId: string,
        entries: ReadonlyArray<IrrigationScheduleEntry>,
        today: dayjs.Dayjs,
        scheduleId: string,
    ): Promise<ReplaceForZoneResult>;

    /** Stamps the cycle's `fired_at` column. Called after a successful HA open. */
    markCycleFired(cycleId: string, firedAt: Date): Promise<void>;

    /** Stamps the cycle's `closed_at` column. Called after a successful HA close. */
    markCycleClosed(cycleId: string, closedAt: Date): Promise<void>;

    /**
     * Returns up to `limit` rows of the `scheduleEntries × zones × leftJoin
     * irrigationCycles` join filtered by `date >= fromDate` and
     * `source = 'scheduled'`. Ordered by date, then zone id, then cycle
     * start time. Used by the schedules-list and tonight modules to derive
     * the next upcoming irrigation night.
     */
    findScheduledFromDate(fromDate: string, limit: number): Promise<NextRunJoinedRow[]>;
}

/**
 * Builds the production `ScheduleEntriesRepository` bound to a Drizzle client.
 */
export function createScheduleEntriesRepository(db: Database): ScheduleEntriesRepository {
    const loadJoined = async (cond: ReturnType<typeof and>): Promise<FutureCycleJoinedRow[]> => {
        return db
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
            .where(cond);
    };

    return {
        loadFutureCycles: async (now) => {
            const rows = await loadJoined(
                and(
                    isNull(irrigationCycles.firedAt),
                    gt(irrigationCycles.startTime, now),
                    eq(zones.isEnabled, true),
                ),
            );
            const pairs = rows.map(mapFutureCycleRow);
            console.log(`schedule-entries: loaded ${pairs.length} future cycle(s).`);
            return pairs;
        },

        loadInFlightCycles: async () => {
            const rows = await loadJoined(
                and(
                    isNotNull(irrigationCycles.firedAt),
                    isNull(irrigationCycles.closedAt),
                ),
            );
            const pairs = rows.map(mapFutureCycleRow);
            console.log(`schedule-entries: loaded ${pairs.length} in-flight cycle(s).`);
            return pairs;
        },

        replaceForZone: async (zoneId, entries, today, scheduleId) => {
            const todayIso = today.format('YYYY-MM-DD');
            console.log(`schedule-entries: replacing schedule for zone ${zoneId} from ${todayIso} (${entries.length} entry/entries).`);

            await db
                .delete(scheduleEntries)
                .where(and(eq(scheduleEntries.zoneId, zoneId), gte(scheduleEntries.date, todayIso)));

            const persisted: PersistedCycle[] = [];

            for (const entry of entries) {
                const entryDate = entry.date.format('YYYY-MM-DD');
                const inserted = await db
                    .insert(scheduleEntries)
                    .values([
                        {
                            zoneId,
                            scheduleId,
                            date: entryDate,
                            appliedDepthMm: entry.appliedDepthMm,
                            depletionBeforeMm: entry.depletionBeforeMm,
                            depletionAfterMm: entry.depletionAfterMm,
                            sunriseAt: entry.sunriseAt?.toDate() ?? null,
                        },
                    ])
                    .returning({ id: scheduleEntries.id });

                const entryId = (inserted[0] as { id: string } | undefined)?.id;
                if (!entryId) {
                    console.warn(`schedule-entries: insert returned no id for zone ${zoneId} on ${entryDate}; skipping cycles.`);
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
                        entryDate,
                    });
                }
            }

            return { cycles: persisted };
        },

        markCycleFired: async (cycleId, firedAt) => {
            await db.update(irrigationCycles).set({ firedAt }).where(eq(irrigationCycles.id, cycleId));
        },

        markCycleClosed: async (cycleId, closedAt) => {
            await db.update(irrigationCycles).set({ closedAt }).where(eq(irrigationCycles.id, cycleId));
        },

        findScheduledFromDate: async (fromDate, limit) => {
            return db
                .select({
                    entry: scheduleEntries,
                    cycle: irrigationCycles,
                    zone: { id: zones.id, name: zones.name },
                })
                .from(scheduleEntries)
                .innerJoin(zones, eq(scheduleEntries.zoneId, zones.id))
                .leftJoin(irrigationCycles, eq(irrigationCycles.scheduleEntryId, scheduleEntries.id))
                .where(and(gte(scheduleEntries.date, fromDate), eq(scheduleEntries.source, 'scheduled')))
                .orderBy(asc(scheduleEntries.date), asc(zones.id), asc(irrigationCycles.startTime))
                .limit(limit);
        },
    };
}

function mapFutureCycleRow(row: FutureCycleJoinedRow): FutureCyclePair {
    return {
        cycle: {
            id: row.cycle.id,
            startTime: row.cycle.startTime,
            durationMin: row.cycle.durationMin,
            entryDate: row.scheduleEntry.date,
        },
        zone: joinedRowToZone({
            zone: row.zone,
            grassType: row.grassType,
            soilType: row.soilType,
            site: row.site,
        }),
    };
}
