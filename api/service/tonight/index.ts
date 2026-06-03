import dayjs from '@/util/dayjs';
import type { Database } from '@/db';
import type { TonightCycle, TonightDto, TonightState, TonightZone } from '@/models/tonight';
import {
    createTonightRepository,
    type TonightJoinedRow,
    type TonightRepository,
} from '@/repositories/tonight';
import { loadActiveSchedulesBySite } from '@/service/schedules';
import { getSiteTimezone } from '@/service/sites';
import { getSystemState } from '@/service/system';

/**
 * Input to `bootTonightService`. Production passes `{ db }`; tests pass
 * `{ repo }` with an object-literal fake.
 */
export type BootTonightServiceInput =
    | { db: Database }
    | { repo: TonightRepository };

let repo: TonightRepository | null = null;

/**
 * Wires the tonight service to its repository. Call once at process boot;
 * call again in test `beforeEach` with a fake to isolate behavior.
 */
export function bootTonightService(input: BootTonightServiceInput): void {
    repo = 'repo' in input ? input.repo : createTonightRepository(input.db);
}

function getRepo(): TonightRepository {
    if (!repo) {
        throw new Error('Tonight service not booted — call bootTonightService({ db }) at startup.');
    }
    return repo;
}

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
 * @param now - Wall-clock reference for the "tonight" determination.
 */
export async function getTonightSummary(now: Date): Promise<TonightDto> {
    const siteTimezone = await getSiteTimezone();
    const todaySiteLocal = dayjs(now).tz(siteTimezone).format('YYYY-MM-DD');

    const system = await getSystemState();
    if (!system.irrigationEnabled) {
        return emptyDto('skipped-manual', siteTimezone);
    }

    const activeSchedules = await loadActiveSchedulesBySite();
    for (const sched of activeSchedules.values()) {
        if (sched.skippedNightDate === todaySiteLocal) {
            return emptyDto('skipped-manual', siteTimezone);
        }
    }

    const rows = await getRepo().findEntriesAfter(todaySiteLocal);

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
        return emptyDto('idle', siteTimezone);
    }

    const tonightRows = byDate.get(tonightDate) ?? [];
    return buildDto(tonightRows, siteTimezone);
}

function emptyDto(state: TonightState, siteTimezone: string): TonightDto {
    return {
        state,
        startTime: null,
        endsAt: null,
        axisStart: null,
        axisEnd: null,
        sunset: null,
        sunrise: null,
        timezone: siteTimezone,
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

    for (const row of rows) {
        if (firstSunriseAt === null && row.entry.sunriseAt !== null) firstSunriseAt = row.entry.sunriseAt;

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
        return emptyDto('idle', siteTimezone);
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

    const sunset = null;
    const sunrise = firstSunriseAt !== null ? formatSiteLocal(firstSunriseAt, siteTimezone) : null;

    const dtoZones: TonightZone[] = zonesSorted.map(z => ({
        name: z.name,
        slug: z.slug,
        patch: z.patch,
        cycles: z.cycles.map<TonightCycle>(c => ({
            start: formatSiteLocal(c.startTime, siteTimezone),
            durMin: c.durationMin,
        })),
    }));

    return {
        state,
        startTime: startTime.toISOString(),
        endsAt: endsAt.toISOString(),
        axisStart: sunset ?? formatSiteLocal(startTime, siteTimezone),
        axisEnd: sunrise ?? formatSiteLocal(endsAt, siteTimezone),
        sunset,
        sunrise,
        timezone: siteTimezone,
        zoneOrder: zonesSorted.map(z => z.name),
        totalCycles: allCycleStarts.length,
        zones: dtoZones,
    };
}

function formatSiteLocal(d: Date, tz: string): string {
    return dayjs(d).tz(tz).format('HH:mm');
}
