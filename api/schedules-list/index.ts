import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { and, asc, eq, gte, sql } from 'drizzle-orm';
import { irrigationCycles, scheduleEntries, schedules, zones } from '@/db/schema';
import { getSiteTimezone } from '@/service/sites';
import type { Schedule } from '@/service/schedules';

dayjs.extend(utc);
dayjs.extend(timezone);

/**
 * Hard cap on how many entry/cycle rows we'll read for the active-schedule
 * next-run lookup. Same rationale as `TONIGHT_FETCH_LIMIT` — well above any
 * realistic single-night row count.
 */
const NEXT_RUN_FETCH_LIMIT = 200;

/**
 * One allowed irrigation window within a day. `start` and `end` are `HH:MM`
 * strings interpreted in the site's local timezone. Mirrors the
 * `ScheduleTimeWindow` shape from the schema so the wire payload doesn't
 * leak Drizzle types.
 */
export type ScheduleAllowedTimeWindow = {
    start: string;
    end: string;
};

/**
 * Derived "next run" labels rendered on the active-schedule chip and the
 * Schedules screen's active row. Formatted server-side so each client (app,
 * eventually a web dashboard) doesn't reimplement the rules.
 */
export type ScheduleNextRun = {
    inLabel: string;
    whenLabel: string;
    zonesLabel: string;
};

/**
 * Wire shape served by `GET /schedules` — one item per row in the `schedules`
 * table. `nextRun` and `skippedTonight` are present only on the active row
 * (and only when there's actually a next run to describe). Inactive rows
 * omit them so the client doesn't have to disambiguate `null` vs missing.
 */
export type ScheduleListItem = {
    id: string;
    slug: string;
    name: string;
    isActive: boolean;
    allowedDays: number[] | null;
    allowedTimeWindows: ScheduleAllowedTimeWindow[] | null;
    rootDepthMOverride: number | null;
    allowableDepletionFractionOverride: number | null;
    endBySunrise: boolean | null;
    nextRun?: ScheduleNextRun | null;
    skippedTonight?: boolean;
};

type NextRunJoinedRow = {
    entry: typeof scheduleEntries.$inferSelect;
    cycle: typeof irrigationCycles.$inferSelect | null;
    zone: { id: string; name: string };
};

/**
 * Minimal db interface for the active schedule's next-night query. Mirrors
 * the shape used by `api/tonight/` for the same data.
 */
export type ScheduleListLoaderDb = {
    select: (columns: {
        entry: typeof scheduleEntries;
        cycle: typeof irrigationCycles;
        zone: { id: typeof zones.id; name: typeof zones.name };
    }) => {
        from: (table: typeof scheduleEntries) => {
            innerJoin: (table: typeof zones, on: unknown) => {
                leftJoin: (table: typeof irrigationCycles, on: unknown) => {
                    where: (cond: unknown) => {
                        orderBy: (...exprs: ReadonlyArray<unknown>) => {
                            limit: (n: number) => Promise<NextRunJoinedRow[]>;
                        };
                    };
                };
            };
        };
    };
};

/**
 * Composite db interface for the schedules list query (the schedules table
 * read + the next-night join). Site timezone reads go through
 * `@/service/sites` — tests boot that service with a fake.
 */
export type ScheduleListDb = ScheduleListLoaderDb & {
    select: (columns: { schedule: unknown }) => {
        from: (table: unknown) => {
            where: (cond: unknown) => Promise<Array<{ schedule: Schedule }>>;
        };
    };
};

/**
 * Lists every schedule for the mobile app's Schedules screen + drawer footer
 * + Home active-schedule chip. The active schedule additionally carries
 * `skippedTonight` and a derived `nextRun` label block.
 *
 * @param db - Drizzle client (or compatible stub).
 * @param now - Wall-clock reference. Drives both the `skippedTonight`
 *   comparison and the `nextRun` "in X" / "Tonight at Y" formatting.
 */
export async function listSchedules(db: ScheduleListDb, now: Date): Promise<ScheduleListItem[]> {
    const siteTimezone = await getSiteTimezone();
    const nowInTz = dayjs(now).tz(siteTimezone);
    const todaySiteLocal = nowInTz.format('YYYY-MM-DD');

    const rows = await db
        .select({ schedule: schedules })
        .from(schedules)
        .where(sql`true`);

    const items: ScheduleListItem[] = [];
    const activeSchedules: Schedule[] = [];
    for (const row of rows) {
        items.push(toBaseDto(row.schedule));
        if (row.schedule.isActive) activeSchedules.push(row.schedule);
    }

    if (activeSchedules.length === 0) return items;

    // The single-site deploy means there's at most one active schedule; the
    // next-night query doesn't filter by site. If multi-site arrives, this is
    // the spot to filter cycles by `zones.siteId === schedule.siteId`.
    const nextNight = await loadNextNight(db, now, todaySiteLocal);

    for (const active of activeSchedules) {
        const item = items.find(i => i.id === active.id);
        if (!item) continue;
        item.skippedTonight = active.skippedNightDate === todaySiteLocal;
        item.nextRun = nextNight !== null ? buildNextRun(nextNight, nowInTz, siteTimezone) : null;
    }

    return items;
}

function toBaseDto(row: Schedule): ScheduleListItem {
    return {
        id: row.id,
        slug: row.slug,
        name: row.name,
        isActive: row.isActive,
        allowedDays: row.allowedDays,
        allowedTimeWindows: row.allowedTimeWindows ?? null,
        rootDepthMOverride: row.rootDepthMOverride,
        allowableDepletionFractionOverride: row.allowableDepletionFractionOverride,
        endBySunrise: row.endBySunrise,
    };
}

type NextNight = {
    earliestStart: Date;
    zoneOrder: string[];
};

async function loadNextNight(db: ScheduleListLoaderDb, now: Date, todaySiteLocal: string): Promise<NextNight | null> {
    const rows = await db
        .select({
            entry: scheduleEntries,
            cycle: irrigationCycles,
            zone: { id: zones.id, name: zones.name },
        })
        .from(scheduleEntries)
        .innerJoin(zones, eq(scheduleEntries.zoneId, zones.id))
        .leftJoin(irrigationCycles, eq(irrigationCycles.scheduleEntryId, scheduleEntries.id))
        .where(and(gte(scheduleEntries.date, todaySiteLocal), eq(scheduleEntries.source, 'scheduled')))
        .orderBy(asc(scheduleEntries.date), asc(zones.id), asc(irrigationCycles.startTime))
        .limit(NEXT_RUN_FETCH_LIMIT);

    const byDate = new Map<string, NextRunJoinedRow[]>();
    for (const row of rows) {
        const group = byDate.get(row.entry.date) ?? [];
        group.push(row);
        byDate.set(row.entry.date, group);
    }

    const nowMs = now.getTime();
    for (const [, group] of byDate) {
        const futureCycles = group.filter(r => {
            if (r.cycle === null) return false;
            const endMs = r.cycle.startTime.getTime() + r.cycle.durationMin * 60_000;
            return endMs > nowMs;
        });
        if (futureCycles.length === 0) continue;

        const sorted = [...futureCycles].sort((a, b) =>
            (a.cycle!.startTime.getTime()) - (b.cycle!.startTime.getTime()),
        );
        const earliestStart = sorted[0]!.cycle!.startTime;
        const zoneOrder: string[] = [];
        const seen = new Set<string>();
        for (const r of sorted) {
            if (seen.has(r.zone.id)) continue;
            seen.add(r.zone.id);
            zoneOrder.push(r.zone.name);
        }
        return { earliestStart, zoneOrder };
    }

    return null;
}

function buildNextRun(nextNight: NextNight, now: dayjs.Dayjs, siteTimezone: string): ScheduleNextRun {
    const startInTz = dayjs(nextNight.earliestStart).tz(siteTimezone);
    return {
        inLabel: formatInLabel(nextNight.earliestStart.getTime(), now.valueOf()),
        whenLabel: formatWhenLabel(startInTz, now),
        zonesLabel: nextNight.zoneOrder.join(', '),
    };
}

/**
 * Formats `startMs - nowMs` as a human-readable "in X" string. Returns
 * `"Running now"` when the gap is non-positive (cycle already started or
 * is firing right now). Exported for direct unit testing.
 */
export function formatInLabel(startMs: number, nowMs: number): string {
    const deltaMs = startMs - nowMs;
    if (deltaMs <= 0) return 'Running now';
    const minutes = Math.round(deltaMs / 60_000);
    if (minutes < 60) return `in ${minutes} min`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `in ${hours} ${hours === 1 ? 'hour' : 'hours'}`;
    const days = Math.round(hours / 24);
    return `in ${days} ${days === 1 ? 'day' : 'days'}`;
}

/**
 * Formats a site-local start time as `"<Tonight|Tomorrow|<DayName>> at h:mm A"`.
 * The day-name prefix uses the long-form English weekday (`Wednesday`) to match
 * the spec's example, falling back to short-form would lose hover-target
 * information on the mobile chip. Exported for direct unit testing.
 */
export function formatWhenLabel(start: dayjs.Dayjs, now: dayjs.Dayjs): string {
    const dayDiff = start.startOf('day').diff(now.startOf('day'), 'day');
    const prefix =
        dayDiff <= 0 ? 'Tonight'
        : dayDiff === 1 ? 'Tomorrow'
        : start.format('dddd');
    const time = start.format('h:mm A');
    return `${prefix} at ${time}`;
}
