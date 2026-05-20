import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { clearAlertsByClass, noopAlertRecorder, type AlertRecorder, type AlertsDb } from '@/alerts';
import {
    closeZone as defaultCloseZone,
    getZoneState as defaultGetZoneState,
    openZone as defaultOpenZone,
    type ZoneRelayState,
} from '@/data/home-assistant';
import type { Zone } from '@/models';
import { noopNotifier, type Notifier } from '@/notifications';
import { runScheduleForZone, type RunScheduleForZoneOptions } from '@/schedules';
import type { PlanZoneScheduleResult } from '@/schedules/dynamic';
import { reconcileCycleAndRelayState, type ReconcileSummary } from './reconcile';
import { loadActiveSchedulesBySite, type Schedule, type ScheduleManagerDb } from './schedule-manager';
import { loadFutureCycles, loadInFlightCycles, replaceZoneSchedule, type FutureCyclesDb, type ScheduleWriterDb } from './schedules';
import {
    armCloseOnly,
    armCycle,
    closeAllInFlight,
    realClock,
    TimerRegistry,
    type Clock,
    type RuntimeDb,
    type ScheduleEndMarker,
    type ScheduleStartMarker,
} from './runtime';
import type { PersistedCycle } from './schedules';
import { loadSiteTimezone, type SiteTimezoneDb } from './sites';
import {
    isWeatherStale,
    markWeatherFetchSuccessful,
    type WeatherStateDb,
} from './weather-state';
import { countZones, loadEnabledZones, type ZoneCountDb, type ZoneLoaderDb } from './zones';

dayjs.extend(utc);
dayjs.extend(timezone);

const DEFAULT_REPLAN_HOUR_LOCAL = 4;

/**
 * Composite db type the daemon needs across its helpers. Production callers
 * pass the eager `db` export from `@/db`; tests pass a recording stub that
 * implements the union of the smaller per-helper interfaces.
 */
export type DaemonDb = ZoneLoaderDb & ScheduleWriterDb & FutureCyclesDb & RuntimeDb & ZoneCountDb & SiteTimezoneDb & ScheduleManagerDb & WeatherStateDb & AlertsDb;

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

    /** Override the HA state-query primitive. Used by boot reconciliation. */
    getZoneState?: (zone: Zone) => Promise<ZoneRelayState>;

    /** Override for time/timer access. */
    clock?: Clock;

    /** Override the resolved site timezone (skips the DB lookup). Used by tests. */
    siteTimezone?: string;

    /** Override the notifier. Defaults to the no-op so tests don't have to. */
    notifier?: Notifier;

    /**
     * Override the alert recorder. Defaults to the no-op so tests don't have to
     * provide a recording stub. Production wires `createAlertRecorder(db)`.
     */
    alertRecorder?: AlertRecorder;
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
    const getZoneState = options?.getZoneState ?? defaultGetZoneState;

    const registry = new TimerRegistry();
    const notifier = options?.notifier ?? noopNotifier;
    const alertRecorder = options?.alertRecorder ?? noopAlertRecorder;
    let lastRePlanAt: Date | null = null;
    let started = false;

    const siteTimezone = options?.siteTimezone ?? await loadSiteTimezone(db);

    console.log(`daemon: starting (re-plan hour: ${rePlanHourLocal}:00 ${siteTimezone}).`);

    const enabledZonesAtBoot = await loadEnabledZones(db);
    const reconcileSummary: ReconcileSummary = await reconcileCycleAndRelayState({
        db,
        clock,
        registry,
        notifier,
        alertRecorder,
        closeZone,
        getZoneState,
        loadInFlightCycles,
        armCloseOnly,
        managedZones: enabledZonesAtBoot.filter(z => z.homeAssistantEntityId !== undefined),
    });
    console.log(`daemon: reconcile summary — resumed: ${reconcileSummary.resumed}, forcedClosed: ${reconcileSummary.forcedClosed}, missedClose: ${reconcileSummary.missedClose}, orphansClosed: ${reconcileSummary.orphansClosed}, errors: ${reconcileSummary.errors}.`);

    const futureCycles = await loadFutureCycles(db, clock.now());
    // Boot-recovery arms leave the schedule markers undefined — schedule-begun
    // and schedule-ended for this night, if applicable, were already emitted by
    // the prior process, and re-emitting on every restart would be misleading.
    for (const { cycle, zone } of futureCycles) {
        armCycle({ db, clock, registry, zone, cycle, openZone, closeZone, notifier, alertRecorder });
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
        const activeSchedulesBySite: Map<string, Schedule> = await loadActiveSchedulesBySite(db);
        const today = dayjs(clock.now()).format('YYYY-MM-DD');
        const now = clock.now();
        const busyWindows: Array<{ start: Date; end: Date }> = registry.snapshotInFlight()
            .map(({ endTime }) => ({ start: now, end: endTime }));
        // Sentinel covering the entire past so deconflictCycles shifts any
        // cycle whose planned start has already passed to fire at or after now.
        const pastWindow: { start: Date; end: Date } = { start: new Date(0), end: now };

        // Defer arming until the planning loop is done so we can group cycles
        // by irrigation night and tag the first/last cycle of each night for
        // schedule-begun / schedule-ended notifications.
        const cyclesToArm: Array<{ zone: Zone; cycle: PersistedCycle }> = [];

        for (const zone of enabledZones) {
            const activeSchedule = activeSchedulesBySite.get(zone.siteId);
            if (!activeSchedule) {
                console.warn(`daemon: no active schedule for site ${zone.siteId} — skipping zone ${zone.id} (${zone.name}).`);
                continue;
            }

            try {
                const restrictions = {
                    allowedDays: activeSchedule.allowedDays,
                    allowedTimeWindows: activeSchedule.allowedTimeWindows,
                    endBySunrise: activeSchedule.endBySunrise ?? false,
                };
                const overrides = {
                    rootDepthM: activeSchedule.rootDepthMOverride ?? undefined,
                    allowableDepletionFraction: activeSchedule.allowableDepletionFractionOverride ?? undefined,
                };
                const { entries, projectedNextDepletionMm } = await runPlan(zone, {
                    busyWindows: [pastWindow, ...busyWindows],
                    restrictions,
                    overrides,
                    forecastDays: 14,
                });
                const { cycles } = await replaceZoneSchedule(db, zone.id, entries, today, projectedNextDepletionMm, activeSchedule.id);
                for (const cycle of cycles) {
                    const cycleEnd = new Date(cycle.startTime.getTime() + cycle.durationMin * 60_000);
                    const overlaps = busyWindows.some(w => cycle.startTime < w.end && cycleEnd > w.start);
                    if (overlaps) {
                        console.warn(`daemon: cycle ${cycle.id} for zone ${zone.id} (${zone.name}) overlaps a busy window — not arming.`);
                        continue;
                    }
                    cyclesToArm.push({ zone, cycle });
                    busyWindows.push({ start: cycle.startTime, end: cycleEnd });
                }
                // Successful runPlan implies a successful weather fetch — refresh
                // the staleness timestamp and clear any lingering unacked
                // weather-stale alert so the UI region collapses on recovery.
                await Promise.all([
                    markWeatherFetchSuccessful(db, clock.now()),
                    clearAlertsByClass(db, 'weather-stale'),
                ]);
            } catch (err) {
                const reason = err instanceof Error ? err.message : String(err);
                console.error(`daemon: re-plan failed for zone ${zone.id}.`, err);
                await notifier('error', { zoneName: zone.name, operation: 're-plan', reason });
                if (await isWeatherStale(db, clock.now())) {
                    await alertRecorder({
                        class: 'weather-stale',
                        tone: 'warn',
                        title: 'Weather API stale',
                        sub: `Planner on fallback ET₀ · last attempt failed: ${reason}`,
                    });
                }
            }
        }

        armCyclesWithScheduleMarkers(cyclesToArm, siteTimezone, ({ zone, cycle, scheduleStart, scheduleEnd }) => {
            armCycle({ db, clock, registry, zone, cycle, openZone, closeZone, notifier, alertRecorder, scheduleStart, scheduleEnd });
        });

        lastRePlanAt = clock.now();
        scheduleNextRePlan();
        console.log('daemon: re-plan complete.');
    };

    const shutdown = async (): Promise<void> => {
        console.log('daemon: shutdown starting.');
        registry.cancelAllTimers(clock);
        await closeAllInFlight({ db, clock, registry, closeZone, notifier, alertRecorder });
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

/**
 * Tagged cycle ready for `armCycle`. The marker fields decide whether the
 * runtime emits `schedule-begun` / `schedule-ended` after the cycle's
 * open/close.
 */
export type ArmableCycle = {
    zone: Zone;
    cycle: PersistedCycle;
    scheduleStart?: ScheduleStartMarker;
    scheduleEnd?: ScheduleEndMarker;
};

/**
 * Groups cycles by their `entryDate` (one entry-date = one irrigation
 * night), sorts each group by start time, and tags the earliest cycle of
 * each group with `scheduleStart` and the latest with `scheduleEnd`. The
 * end marker carries the night's per-zone runtime summary and a pointer
 * to the next night's earliest cycle (when one exists in the same batch).
 *
 * Pure function — exported for test coverage of the marking logic
 * independent of the daemon's surrounding orchestration.
 *
 * @param cyclesToArm - Cycles selected for arming, in any order.
 * @param siteTimezone - Site timezone, copied onto each end marker so
 *   `buildMessage` can format the next-irrigation time in site-local.
 * @param arm - Callback that performs the actual arming with the resolved
 *   markers. Invoked once per cycle in chronological order.
 */
export function armCyclesWithScheduleMarkers(
    cyclesToArm: ReadonlyArray<{ zone: Zone; cycle: PersistedCycle }>,
    siteTimezone: string,
    arm: (input: ArmableCycle) => void,
): void {
    if (cyclesToArm.length === 0) return;

    const byNight = new Map<string, Array<{ zone: Zone; cycle: PersistedCycle }>>();
    for (const c of cyclesToArm) {
        const group = byNight.get(c.cycle.entryDate) ?? [];
        group.push(c);
        byNight.set(c.cycle.entryDate, group);
    }

    const nights = [...byNight.keys()].sort();
    for (const group of byNight.values()) {
        group.sort((a, b) => a.cycle.startTime.getTime() - b.cycle.startTime.getTime());
    }

    for (let i = 0; i < nights.length; i++) {
        const night = nights[i]!;
        const group = byNight.get(night)!;
        const first = group[0]!;
        const last = group[group.length - 1]!;

        const perZoneRuntimeMin: Record<string, number> = {};
        for (const { zone, cycle } of group) {
            perZoneRuntimeMin[zone.name] = (perZoneRuntimeMin[zone.name] ?? 0) + cycle.durationMin;
        }

        const nextNight = i + 1 < nights.length ? byNight.get(nights[i + 1]!) : undefined;
        const nextFirst = nextNight?.[0];
        const scheduleEnd: ScheduleEndMarker = {
            scheduleNight: night,
            perZoneRuntimeMin,
            siteTimezone,
            ...(nextFirst ? { nextIrrigation: { zoneName: nextFirst.zone.name, startTime: nextFirst.cycle.startTime } } : {}),
        };
        const scheduleStart: ScheduleStartMarker = { scheduleNight: night };

        for (const item of group) {
            arm({
                zone: item.zone,
                cycle: item.cycle,
                ...(item === first ? { scheduleStart } : {}),
                ...(item === last ? { scheduleEnd } : {}),
            });
        }
    }
}
