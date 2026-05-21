import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { and, asc, eq, gte } from 'drizzle-orm';
import { irrigationCycles, scheduleEntries, sites, zones } from '@/db/schema';
import { loadActiveSchedulesBySite, type ScheduleManagerDb } from '@/daemon/schedule-manager';
import { loadSiteTimezone, type SiteTimezoneDb } from '@/daemon/sites';
import { getSystemState, type SystemStateReaderDb } from '@/system';

dayjs.extend(utc);
dayjs.extend(timezone);

/**
 * Hard cap on how many entry/cycle rows we'll read for the "tonight" lookup.
 * One night × all zones × handful of cycles is well under 50 rows even for
 * the largest realistic installs; 200 is room to spare.
 */
const TONIGHT_FETCH_LIMIT = 200;

/**
 * The five lifecycle states the mobile Home hero can render. `scheduled` and
 * `firing` are derived from per-cycle fire/close timestamps. `idle` covers
 * "no planner output for the next night yet" — typical when the soil isn't
 * dry enough to trigger irrigation. `skipped-manual` covers both the master
 * kill switch and the per-night skip marker. `skipped-rain` is reserved for
 * a future signal that distinguishes "no irrigation needed because rain
 * replenished soil" from `idle` — not emitted today.
 */
export type TonightState = 'scheduled' | 'firing' | 'idle' | 'skipped-rain' | 'skipped-manual';

/**
 * One cycle in the per-zone payload. `start` is the cycle's fire time
 * formatted as `HH:MM` in the site timezone — the CycleStrip renders against
 * a site-local axis, so absolute UTC isn't useful here.
 */
export type TonightCycle = {
    start: string;
    durMin: number;
};

/**
 * Per-zone summary for the night. `patch` carries the zone's visual variant
 * (`'a'`, `'b'`, `'c'`) — the mobile app maps that to color/glow tokens.
 * Matches the contract on `GET /zones`.
 */
export type TonightZone = {
    name: string;
    slug: string;
    patch: string;
    cycles: TonightCycle[];
};

/**
 * Wire shape served by `GET /tonight`.
 *
 * `startTime` / `endsAt` are ISO-8601 UTC instants (or `null` when idle or
 * skipped — there's nothing to anchor them to). `axisStart` / `axisEnd` are
 * site-local `HH:MM` strings that bound the CycleStrip x-axis; they fall
 * back to a tight padding around `startTime`/`endsAt` when `sunset`/`sunrise`
 * aren't yet persisted on the underlying entries. `sunset` / `sunrise` are
 * site-local `HH:MM` strings (or `null` during the bootstrap window before
 * the planner has populated the columns).
 */
export type TonightDto = {
    state: TonightState;
    startTime: string | null;
    endsAt: string | null;
    axisStart: string | null;
    axisEnd: string | null;
    sunset: string | null;
    sunrise: string | null;
    zoneOrder: string[];
    totalCycles: number;
    zones: TonightZone[];
};

type TonightJoinedRow = {
    entry: typeof scheduleEntries.$inferSelect;
    cycle: typeof irrigationCycles.$inferSelect | null;
    zone: { id: string; name: string; slug: string; patch: string };
};

/**
 * Minimal db interface for the tonight lister's joined-row query. The
 * production Drizzle `db` satisfies this directly; tests pass a recording
 * stub.
 */
export type TonightLoaderDb = {
    select: (columns: {
        entry: typeof scheduleEntries;
        cycle: typeof irrigationCycles;
        zone: {
            id: typeof zones.id;
            name: typeof zones.name;
            slug: typeof zones.slug;
            patch: typeof zones.patch;
        };
    }) => {
        from: (table: typeof scheduleEntries) => {
            innerJoin: (table: typeof zones, on: unknown) => {
                leftJoin: (table: typeof irrigationCycles, on: unknown) => {
                    where: (cond: unknown) => {
                        orderBy: (...exprs: ReadonlyArray<unknown>) => {
                            limit: (n: number) => Promise<TonightJoinedRow[]>;
                        };
                    };
                };
            };
        };
    };
};

/**
 * Composite db interface. Production callers pass the eager `db` export from
 * `@/db`; tests compose stubs from the per-helper interfaces.
 */
export type TonightDb = SiteTimezoneDb & SystemStateReaderDb & ScheduleManagerDb & TonightLoaderDb;

/**
 * Builds the wire payload powering the mobile Home screen's "Next run" hero
 * card and CycleStrip. See `TonightDto` for the field contracts.
 *
 * Resolution order:
 * 1. Master kill switch off → `state: 'skipped-manual'`.
 * 2. Active schedule has tonight as its `skippedNightDate` → `state: 'skipped-manual'`.
 * 3. No `schedule_entries` qualifying as "tonight" → `state: 'idle'`.
 * 4. Any tonight cycle has `firedAt && !closedAt` → `state: 'firing'`.
 * 5. Otherwise → `state: 'scheduled'`.
 *
 * "Tonight" is the earliest entry-date `>= site-local today` whose cycles
 * extend past `now`. After the night's last cycle has closed and we're back
 * in daytime, this naturally picks up tomorrow's entry-date.
 *
 * @param db - Drizzle client (or compatible stub).
 * @param now - Wall-clock reference for the "tonight" determination.
 */
export async function getTonightSummary(db: TonightDb, now: Date): Promise<TonightDto> {
    const siteTimezone = await loadSiteTimezone(db);
    const todaySiteLocal = dayjs(now).tz(siteTimezone).format('YYYY-MM-DD');

    const system = await getSystemState(db);
    if (!system.irrigationEnabled) {
        return emptyDto('skipped-manual');
    }

    const activeSchedules = await loadActiveSchedulesBySite(db);
    for (const sched of activeSchedules.values()) {
        if (sched.skippedNightDate === todaySiteLocal) {
            return emptyDto('skipped-manual');
        }
    }

    const rows = await db
        .select({
            entry: scheduleEntries,
            cycle: irrigationCycles,
            zone: { id: zones.id, name: zones.name, slug: zones.slug, patch: zones.patch },
        })
        .from(scheduleEntries)
        .innerJoin(zones, eq(scheduleEntries.zoneId, zones.id))
        .leftJoin(irrigationCycles, eq(irrigationCycles.scheduleEntryId, scheduleEntries.id))
        .where(and(gte(scheduleEntries.date, todaySiteLocal), eq(scheduleEntries.source, 'scheduled')))
        .orderBy(asc(scheduleEntries.date), asc(zones.id), asc(irrigationCycles.startTime))
        .limit(TONIGHT_FETCH_LIMIT);

    // Group rows by entry-date so we can find the first date whose cycles
    // still have time on them, then collapse to that date.
    const byDate = new Map<string, TonightJoinedRow[]>();
    for (const row of rows) {
        const group = byDate.get(row.entry.date) ?? [];
        group.push(row);
        byDate.set(row.entry.date, group);
    }

    const tonightDate = pickTonightDate(byDate, now);
    if (tonightDate === null) {
        return emptyDto('idle');
    }

    const tonightRows = byDate.get(tonightDate) ?? [];
    return buildDto(tonightRows, siteTimezone);
}

function emptyDto(state: TonightState): TonightDto {
    return {
        state,
        startTime: null,
        endsAt: null,
        axisStart: null,
        axisEnd: null,
        sunset: null,
        sunrise: null,
        zoneOrder: [],
        totalCycles: 0,
        zones: [],
    };
}

function pickTonightDate(byDate: Map<string, TonightJoinedRow[]>, now: Date): string | null {
    const nowMs = now.getTime();
    // Map iteration order matches insertion order, which is `date ASC` from
    // the query — so the first match is the earliest qualifying date.
    for (const [date, group] of byDate) {
        const hasFutureWork = group.some(row => {
            if (row.cycle === null) return false;
            const endMs = row.cycle.startTime.getTime() + row.cycle.durationMin * 60_000;
            return endMs > nowMs;
        });
        if (hasFutureWork) return date;
    }
    return null;
}

type ZoneAccumulator = {
    id: string;
    name: string;
    slug: string;
    patch: string;
    cycles: Array<{ startTime: Date; durationMin: number }>;
};

function buildDto(rows: TonightJoinedRow[], siteTimezone: string): TonightDto {
    const cyclesFiring: boolean[] = [];
    const allCycleStarts: Date[] = [];
    const allCycleEnds: Date[] = [];
    const zoneAccumulator = new Map<string, ZoneAccumulator>();
    let firstSunriseAt: Date | null = null;
    let firstSunsetAt: Date | null = null;

    for (const row of rows) {
        if (firstSunriseAt === null && row.entry.sunriseAt !== null) firstSunriseAt = row.entry.sunriseAt;
        if (firstSunsetAt === null && row.entry.sunsetAt !== null) firstSunsetAt = row.entry.sunsetAt;

        if (row.cycle === null) continue;
        cyclesFiring.push(row.cycle.firedAt !== null && row.cycle.closedAt === null);
        allCycleStarts.push(row.cycle.startTime);
        allCycleEnds.push(new Date(row.cycle.startTime.getTime() + row.cycle.durationMin * 60_000));

        const acc = zoneAccumulator.get(row.zone.id) ?? {
            id: row.zone.id,
            name: row.zone.name,
            slug: row.zone.slug,
            patch: row.zone.patch,
            cycles: [],
        };
        acc.cycles.push({ startTime: row.cycle.startTime, durationMin: row.cycle.durationMin });
        zoneAccumulator.set(row.zone.id, acc);
    }

    if (allCycleStarts.length === 0) {
        // Edge case: entries exist for the date but no cycles (e.g. day was
        // restricted post-planning). Treat as idle — there's nothing to render.
        return emptyDto('idle');
    }

    const state: TonightState = cyclesFiring.some(x => x) ? 'firing' : 'scheduled';
    const startTime = new Date(Math.min(...allCycleStarts.map(d => d.getTime())));
    const endsAt = new Date(Math.max(...allCycleEnds.map(d => d.getTime())));

    // Zone order: by first-fire time ascending. Stable secondary sort by name
    // for zones whose first cycle ties exactly.
    const zonesSorted = [...zoneAccumulator.values()].sort((a, b) => {
        const aStart = a.cycles[0]?.startTime.getTime() ?? 0;
        const bStart = b.cycles[0]?.startTime.getTime() ?? 0;
        if (aStart !== bStart) return aStart - bStart;
        return a.name.localeCompare(b.name);
    });

    const sunset = firstSunsetAt !== null ? formatSiteLocal(firstSunsetAt, siteTimezone) : null;
    const sunrise = firstSunriseAt !== null ? formatSiteLocal(firstSunriseAt, siteTimezone) : null;

    return {
        state,
        startTime: startTime.toISOString(),
        endsAt: endsAt.toISOString(),
        axisStart: sunset ?? formatSiteLocal(startTime, siteTimezone),
        axisEnd: sunrise ?? formatSiteLocal(endsAt, siteTimezone),
        sunset,
        sunrise,
        zoneOrder: zonesSorted.map(z => z.name),
        totalCycles: allCycleStarts.length,
        zones: zonesSorted.map(z => ({
            name: z.name,
            slug: z.slug,
            patch: z.patch,
            cycles: z.cycles.map(c => ({
                start: formatSiteLocal(c.startTime, siteTimezone),
                durMin: c.durationMin,
            })),
        })),
    };
}

function formatSiteLocal(d: Date, tz: string): string {
    return dayjs(d).tz(tz).format('HH:mm');
}

// Drizzle re-exports — keep them used so tree-shaking doesn't drop the imports.
void sites;
