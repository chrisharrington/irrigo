import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { closeZone as defaultCloseZone, openZone as defaultOpenZone } from '@/data/home-assistant';
import type { Zone } from '@/models';
import { runScheduleForZone, type RunScheduleForZoneOptions } from '@/schedules';
import type { PlanZoneScheduleResult } from '@/schedules/dynamic';
import { loadFutureCycles, replaceZoneSchedule, type FutureCyclesDb, type ScheduleWriterDb } from './schedules';
import { armCycle, closeAllInFlight, realClock, TimerRegistry, type Clock, type RuntimeDb } from './runtime';
import { loadSiteTimezone, type SiteTimezoneDb } from './sites';
import { countZones, loadEnabledZones, type ZoneCountDb, type ZoneLoaderDb } from './zones';

dayjs.extend(utc);
dayjs.extend(timezone);

const DEFAULT_REPLAN_HOUR_LOCAL = 4;

/**
 * Composite db type the daemon needs across its helpers. Production callers
 * pass the eager `db` export from `@/db`; tests pass a recording stub that
 * implements the union of the smaller per-helper interfaces.
 */
export type DaemonDb = ZoneLoaderDb & ScheduleWriterDb & FutureCyclesDb & RuntimeDb & ZoneCountDb & SiteTimezoneDb;

/**
 * Caller-overridable hooks. Defaults wire to the real planning function and
 * the real Home Assistant client. The clock defaults to `realClock`.
 */
export type DaemonOptions = {
    /** Local hour at which the daily re-plan fires. Default 4. */
    rePlanHourLocal?: number;

    /** Planner override. Defaults to the real `runScheduleForZone`. */
    runPlan?: (zone: Zone, options?: RunScheduleForZoneOptions) => Promise<PlanZoneScheduleResult>;

    /** Override the HA open-relay primitive. */
    openZone?: (zone: Zone) => Promise<void>;

    /** Override the HA close-relay primitive. */
    closeZone?: (zone: Zone) => Promise<void>;

    /** Override for time/timer access. */
    clock?: Clock;

    /** Override the resolved site timezone (skips the DB lookup). Used by tests. */
    siteTimezone?: string;
};

/**
 * Snapshot of the daemon's runtime state for the HTTP `/health` endpoint and
 * any other ops surface that needs to know whether the scheduling loop is
 * alive and what it's currently doing. `lastRePlanAt` is ISO-8601 UTC so it
 * round-trips cleanly through JSON.
 */
export type DaemonStatus = {
    /** True once `start()` has finished its initial bootstrap. */
    alive: boolean;

    /** ISO-8601 UTC of the most recent successful re-plan, or null if none yet. */
    lastRePlanAt: string | null;

    /** Zones whose relay is currently open (cycle fired, close pending). */
    activeZones: ReadonlyArray<{ id: string; name: string }>;
};

/**
 * Control surface returned from `start`. Lets the unified entrypoint (and
 * tests) drive the daemon without reaching into its internals.
 */
export type DaemonControl = {
    /** Forces an immediate re-plan + arm cycle. */
    rePlan: () => Promise<void>;

    /** Cancels all timers and closes any in-flight relay. */
    shutdown: () => Promise<void>;

    /** Snapshot of daemon liveness and currently active zones. */
    getStatus: () => DaemonStatus;
};

/**
 * Boots the daemon: arms whatever future cycles already exist in the DB and
 * schedules the next daily re-plan. Does **not** trigger an immediate re-plan
 * — bootstrapping a fresh DB requires either waiting for the configured hour
 * or calling `rePlan()` on the returned control handle.
 *
 * @param db - Daemon-compatible Drizzle client.
 * @param options - Overrides for hooks, hour, or clock.
 * @returns Control handle for forcing re-plan or shutting down.
 */
export async function start(db: DaemonDb, options?: DaemonOptions): Promise<DaemonControl> {
    const clock = options?.clock ?? realClock;
    const rePlanHourLocal = options?.rePlanHourLocal ?? DEFAULT_REPLAN_HOUR_LOCAL;
    const runPlan = options?.runPlan ?? ((zone, opts) => runScheduleForZone(zone, opts));
    const openZone = options?.openZone ?? defaultOpenZone;
    const closeZone = options?.closeZone ?? defaultCloseZone;

    const registry = new TimerRegistry();
    let lastRePlanAt: Date | null = null;
    let started = false;

    const siteTimezone = options?.siteTimezone ?? await loadSiteTimezone(db);

    console.log(`daemon: starting (re-plan hour: ${rePlanHourLocal}:00 ${siteTimezone}).`);

    const futureCycles = await loadFutureCycles(db, clock.now());
    for (const { cycle, zone } of futureCycles) {
        armCycle({ db, clock, registry, zone, cycle, openZone, closeZone });
    }

    const { total, enabled } = await countZones(db);
    if (total === 0) {
        console.warn('daemon: has no zones to manage. Did you run `bun run seed`? Daemon is idle until zones are added.');
    } else if (enabled === 0) {
        console.warn('daemon: all zones are disabled. Daemon is idle until at least one zone is enabled.');
    }

    const scheduleNextRePlan = (): void => {
        const next = computeNextRePlanAt(clock.now(), rePlanHourLocal, siteTimezone);
        const delay = Math.max(0, next.getTime() - clock.now().getTime());
        console.log(`daemon: next re-plan scheduled at ${next.toISOString()} (${delay}ms from now).`);
        const handle = clock.setTimeout(() => {
            rePlan().catch(err => {
                console.error('daemon: unhandled error in scheduled re-plan.', err);
            });
        }, delay);
        registry.setRePlanHandle(handle);
    };

    const rePlan = async (): Promise<void> => {
        console.log('daemon: re-plan starting.');
        registry.cancelOpenTimers(clock);

        const enabledZones = await loadEnabledZones(db);
        const today = dayjs(clock.now()).format('YYYY-MM-DD');

        for (const zone of enabledZones) {
            try {
                const { entries, projectedNextDepletionMm } = await runPlan(zone);
                const { cycles } = await replaceZoneSchedule(db, zone.id, entries, today, projectedNextDepletionMm);
                for (const cycle of cycles) {
                    armCycle({ db, clock, registry, zone, cycle, openZone, closeZone });
                }
            } catch (err) {
                console.error(`daemon: re-plan failed for zone ${zone.id}.`, err);
            }
        }

        lastRePlanAt = clock.now();
        scheduleNextRePlan();
        console.log('daemon: re-plan complete.');
    };

    const shutdown = async (): Promise<void> => {
        console.log('daemon: shutdown starting.');
        registry.cancelAllTimers(clock);
        await closeAllInFlight({ db, clock, registry, closeZone });
        console.log('daemon: shutdown complete.');
    };

    scheduleNextRePlan();
    started = true;

    const getStatus = (): DaemonStatus => ({
        alive: started,
        lastRePlanAt: lastRePlanAt === null ? null : lastRePlanAt.toISOString(),
        activeZones: registry.snapshotInFlight().map(({ zone }) => ({ id: zone.id, name: zone.name })),
    });

    return { rePlan, shutdown, getStatus };
}

/**
 * Returns the next wall-clock occurrence of `hourLocal:00` after `now`,
 * resolved against the supplied IANA timezone. Pure function exported so the
 * scheduling math is unit-testable directly. The container TZ is irrelevant
 * — the target is always the next 04:00 (or whatever) at the *site*.
 *
 * @param now - Current time (any TZ — only the absolute instant is used).
 * @param hourLocal - Target hour-of-day (0-23) at the site.
 * @param timezone - IANA timezone of the site (e.g. `America/Edmonton`).
 * @returns The absolute Date at which the hour rolls over at the site.
 */
export function computeNextRePlanAt(now: Date, hourLocal: number, timezone: string): Date {
    const ref = dayjs(now).tz(timezone);
    const todayAtHour = ref.hour(hourLocal).minute(0).second(0).millisecond(0);
    const next = todayAtHour.isAfter(ref) ? todayAtHour : todayAtHour.add(1, 'day');
    return next.toDate();
}
