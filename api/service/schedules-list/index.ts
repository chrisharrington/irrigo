import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import type { Database } from '@/db';
import type {
    ScheduleAllowedTimeWindow,
    ScheduleListItem,
    ScheduleNextRun,
} from '@/models/schedules-list';
import {
    createScheduleEntriesRepository,
    type NextRunJoinedRow,
    type ScheduleEntriesRepository,
} from '@/repositories/schedule-entries';
import { createSchedulesRepository, type Schedule, type SchedulesRepository } from '@/repositories/schedules';
import { getSiteTimezone } from '@/service/sites';

dayjs.extend(utc);
dayjs.extend(timezone);

export type { ScheduleAllowedTimeWindow, ScheduleListItem, ScheduleNextRun } from '@/models/schedules-list';

/**
 * Hard cap on how many entry/cycle rows we'll read for the active-schedule
 * next-run lookup. One night × all zones × handful of cycles is well under
 * 50 rows even for the largest realistic installs; 200 is room to spare.
 */
const NEXT_RUN_FETCH_LIMIT = 200;

/**
 * Input to `bootSchedulesListService`. Production passes `{ db }`; tests
 * pass object-literal repos.
 */
export type BootSchedulesListServiceInput =
    | { db: Database }
    | { schedulesRepo: SchedulesRepository; scheduleEntriesRepo: ScheduleEntriesRepository };

let schedulesRepo: SchedulesRepository | null = null;
let scheduleEntriesRepo: ScheduleEntriesRepository | null = null;

/**
 * Wires the schedules-list service to its repository dependencies. Call once
 * at process boot; call again in test `beforeEach` with fakes.
 */
export function bootSchedulesListService(input: BootSchedulesListServiceInput): void {
    if ('db' in input) {
        schedulesRepo = createSchedulesRepository(input.db);
        scheduleEntriesRepo = createScheduleEntriesRepository(input.db);
    } else {
        schedulesRepo = input.schedulesRepo;
        scheduleEntriesRepo = input.scheduleEntriesRepo;
    }
}

function getSchedulesRepo(): SchedulesRepository {
    if (!schedulesRepo) {
        throw new Error('Schedules-list service not booted — call bootSchedulesListService({ db }) at startup.');
    }
    return schedulesRepo;
}

function getScheduleEntriesRepo(): ScheduleEntriesRepository {
    if (!scheduleEntriesRepo) {
        throw new Error('Schedules-list service not booted — call bootSchedulesListService({ db }) at startup.');
    }
    return scheduleEntriesRepo;
}

/**
 * Lists every schedule for the mobile app's Schedules screen + drawer footer
 * + Home active-schedule chip. The active schedule additionally carries
 * `skippedTonight` and a derived `nextRun` label block.
 *
 * @param now - Wall-clock reference. Drives both the `skippedTonight`
 *   comparison and the `nextRun` "in X" / "Tonight at Y" formatting.
 */
export async function listSchedules(now: Date): Promise<ScheduleListItem[]> {
    const siteTimezone = await getSiteTimezone();
    const nowInTz = dayjs(now).tz(siteTimezone);
    const todaySiteLocal = nowInTz.format('YYYY-MM-DD');

    const rows = await getSchedulesRepo().listAll();

    const items: ScheduleListItem[] = [];
    const activeSchedules: Schedule[] = [];
    for (const row of rows) {
        items.push(toBaseDto(row));
        if (row.isActive) activeSchedules.push(row);
    }

    if (activeSchedules.length === 0) return items;

    // The single-site deploy means there's at most one active schedule; the
    // next-night query doesn't filter by site. If multi-site arrives, this is
    // the spot to filter cycles by `zones.siteId === schedule.siteId`.
    const nextNight = await loadNextNight(now, todaySiteLocal);

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

async function loadNextNight(now: Date, todaySiteLocal: string): Promise<NextNight | null> {
    const rows = await getScheduleEntriesRepo().findScheduledFromDate(todaySiteLocal, NEXT_RUN_FETCH_LIMIT);

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
