import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { clearAlertsByClass, noopAlerter, type Alerter } from '@/alerts';
import {
    closeZone as defaultCloseZone,
    getZoneState as defaultGetZoneState,
    openZone as defaultOpenZone,
    type ZoneRelayState,
} from '@/data/home-assistant';
import { getWeatherData, sumHourlyWeatherBetween } from '@/data/weather';
import type { WeatherData, Zone } from '@/models';
import type { PersistedCycle } from '@/models/cycle';
import { noopNotifier, type Notifier } from '@/notifications';
import { runScheduleForZone, type RunScheduleForZoneOptions } from '@/schedules';
import type { PlanZoneScheduleResult } from '@/schedules/dynamic';
import { getSystemState } from '@/service/system';
import { advanceFromObservedWeather } from './depletion';
import { reconcileCycleAndRelayState, type ReconcileSummary } from './reconcile';
import {
    armCloseOnly,
    armCycle,
    closeAllInFlight,
    realClock,
    TimerRegistry,
    type Clock,
    type ScheduleEndMarker,
    type ScheduleStartMarker,
} from './runtime';
import {
    getAlertsDb,
    getScheduleEntriesRepo,
    getSchedulesRepo,
    getSitesRepo,
    getWeatherStateRepo,
    getZonesRepo,
    setDaemonRepos,
    type DaemonServiceRepos,
    type SetDaemonReposInput,
} from './state';

dayjs.extend(utc);
dayjs.extend(timezone);

/**
 * Default hour-of-day (site-local) for the daily re-plan. 20:00 is chosen
 * so Open-Meteo's day-0 `rain_sum` reflects ~20 hours of *observed* rain by
 * the time the planner places tonight's cycles — same-day rainfall lands in
 * the depletion balance before it can influence cycle placement. Forecast
 * rain after 20:00 still flows through day-0's remaining forecast hours and
 * subsequent days unchanged. See API-68.
 */
const DEFAULT_REPLAN_HOUR_LOCAL = 20;

export type BootDaemonServiceInput = SetDaemonReposInput;

/**
 * Wires the daemon service to its repositories. Call once at process boot;
 * call in test `beforeEach` with object-literal fake repos. All service
 * functions (and the runtime / reconcile sub-modules) read from this state.
 */
export function bootDaemonService(input: BootDaemonServiceInput): void {
    setDaemonRepos(input);
}

/**
 * Caller-overridable hooks. Defaults wire to the real planning function and
 * the real Home Assistant client. The clock defaults to `realClock`.
 */
export type DaemonOptions = {
    rePlanHourLocal?: number;
    runPlan?: (zone: Zone, options?: RunScheduleForZoneOptions) => Promise<PlanZoneScheduleResult>;
    /**
     * Reads weather (daily + hourly) for a zone. Defaulted to the real
     * `getWeatherData`. Injected separately from `runPlan` so the daemon can
     * advance depletion against observed hourly weather without the planner
     * having to plumb the hourly array through `PlanZoneScheduleResult`.
     */
    getWeather?: (zone: Zone) => Promise<WeatherData>;
    openZone?: (zone: Zone) => Promise<void>;
    closeZone?: (zone: Zone) => Promise<void>;
    getZoneState?: (zone: Zone) => Promise<ZoneRelayState>;
    clock?: Clock;
    siteTimezone?: string;
    notifier?: Notifier;
    alerter?: Alerter;
};

/**
 * Snapshot of the daemon's runtime state for the HTTP `/health` endpoint.
 */
export type DaemonStatus = {
    alive: boolean;
    lastRePlanAt: string | null;
    activeZones: ReadonlyArray<{ id: string; name: string }>;
};

/**
 * Control surface returned from `start`. Lets the unified entrypoint (and
 * tests) drive the daemon without reaching into its internals.
 */
export type DaemonControl = {
    rePlan: () => Promise<void>;
    shutdown: () => Promise<void>;
    getStatus: () => DaemonStatus;
};

/**
 * Re-export the repo type so api/index.ts can construct it without importing
 * from the internal state module.
 */
export type { DaemonServiceRepos };

/**
 * Boots the daemon: arms whatever future cycles already exist in the DB and
 * schedules the next daily re-plan. Reads repositories from the module-level
 * state set by `bootDaemonService`.
 */
export async function start(options?: DaemonOptions): Promise<DaemonControl> {
    const clock = options?.clock ?? realClock;
    const rePlanHourLocal = options?.rePlanHourLocal ?? DEFAULT_REPLAN_HOUR_LOCAL;
    const runPlan = options?.runPlan ?? ((zone, opts) => runScheduleForZone(zone, opts));
    const getWeather = options?.getWeather ?? (async (zone: Zone): Promise<WeatherData> => {
        if (!zone.location) throw new Error(`daemon: zone ${zone.id} has no location; cannot fetch weather.`);
        return getWeatherData({
            latitude: zone.location.lat,
            longitude: zone.location.lon,
            timezone: zone.siteTimezone,
        });
    });
    const openZone = options?.openZone ?? defaultOpenZone;
    const closeZone = options?.closeZone ?? defaultCloseZone;
    const getZoneState = options?.getZoneState ?? defaultGetZoneState;

    const registry = new TimerRegistry();
    const notifier = options?.notifier ?? noopNotifier;
    const alerter = options?.alerter ?? noopAlerter;
    let lastRePlanAt: Date | null = null;
    let started = false;

    const sitesRepo = getSitesRepo();
    const zonesRepo = getZonesRepo();
    const schedulesRepo = getSchedulesRepo();
    const scheduleEntriesRepo = getScheduleEntriesRepo();
    const weatherStateRepo = getWeatherStateRepo();

    const siteTimezone = options?.siteTimezone ?? await sitesRepo.loadTimezone();

    console.log(`daemon: starting (re-plan hour: ${rePlanHourLocal}:00 ${siteTimezone}).`);

    const enabledZonesAtBoot = await zonesRepo.loadEnabled();
    const reconcileSummary: ReconcileSummary = await reconcileCycleAndRelayState({
        clock,
        registry,
        notifier,
        alerter,
        closeZone,
        getZoneState,
        armCloseOnly,
        managedZones: enabledZonesAtBoot.filter(z => z.homeAssistantEntityId !== undefined),
    });
    console.log(`daemon: reconcile summary — resumed: ${reconcileSummary.resumed}, forcedClosed: ${reconcileSummary.forcedClosed}, missedClose: ${reconcileSummary.missedClose}, orphansClosed: ${reconcileSummary.orphansClosed}, errors: ${reconcileSummary.errors}.`);

    const futureCycles = await scheduleEntriesRepo.loadFutureCycles(clock.now());
    const systemAtBoot = await getSystemState();
    if (!systemAtBoot.irrigationEnabled) {
        console.warn(`daemon: system irrigation is disabled (since ${systemAtBoot.since}); skipping arm of ${futureCycles.length} future cycle(s).`);
    } else {
        for (const { cycle, zone } of futureCycles) {
            armCycle({ clock, registry, zone, cycle, openZone, closeZone, notifier, alerter });
        }
    }

    const { total, enabled } = await zonesRepo.count();
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
            _rePlan(true).catch(err => {
                console.error('daemon: unhandled error in scheduled re-plan.', err);
            });
        }, delay);
        registry.setRePlanHandle(handle);
    };

    // Private implementation. `isScheduledTick` distinguishes the nightly
    // daemon-scheduled re-plan (which advances depletion from observed hourly
    // weather since the last reconciliation, see API-79) from
    // operator-triggered replans (which must be idempotent and must not
    // mutate zone state). See API-71.
    const _rePlan = async (isScheduledTick: boolean): Promise<void> => {
        console.log(`daemon: re-plan starting (scheduled=${isScheduledTick}).`);
        registry.cancelOpenTimers(clock);

        const system = await getSystemState();
        if (!system.irrigationEnabled) {
            console.warn(`daemon: re-plan skipped — system irrigation is disabled (since ${system.since}). All armed cycles cancelled; no new cycles will arm until re-enabled.`);
            lastRePlanAt = clock.now();
            scheduleNextRePlan();
            return;
        }

        // Resolve `today` against the site's IANA timezone so the date cutoff
        // matches the calendar the planner is using. With the container TZ
        // unset, a bare `dayjs(now)` formats in UTC — after 18:00 MDT the UTC
        // calendar rolls forward and `replaceForZone` deletes rows whose
        // `date >= ${UTC-tomorrow}`, leaving the (still site-local-today) rows
        // orphaned in the DB. See API-74.
        const today = dayjs(clock.now()).tz(siteTimezone);
        await schedulesRepo.clearStaleSkipMarkers(today);

        const enabledZones = await zonesRepo.loadEnabled();
        const activeSchedulesBySite = await schedulesRepo.loadActiveBySite();
        const now = clock.now();
        const busyWindows: Array<{ start: Date; end: Date }> = registry.snapshotInFlight()
            .map(({ endTime }) => ({ start: now, end: endTime }));
        const pastWindow: { start: Date; end: Date } = { start: new Date(0), end: now };

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
                    skippedNightDate: activeSchedule.skippedNightDate ?? null,
                };
                const overrides = {
                    rootDepthM: activeSchedule.rootDepthMOverride ?? undefined,
                    allowableDepletionFraction: activeSchedule.allowableDepletionFractionOverride ?? undefined,
                };
                // Reality-derived depletion advance: sum hourly weather since
                // the last reconciliation and apply (ET adds, rain subtracts).
                // A null reconciledAt (fresh seed) is stamped without math —
                // we have no anchor for the prior window, so the first tick
                // calibrates the clock and subsequent ticks roll forward
                // against a known boundary. See API-79.
                const tickNow = clock.now();
                const weather = await getWeather(zone);
                let newDepletionMm = zone.currentDepletionMm;
                let planningZone = zone;
                if (isScheduledTick) {
                    if (zone.currentDepletionReconciledAt) {
                        const weatherDelta = sumHourlyWeatherBetween(
                            weather.hourly, zone.currentDepletionReconciledAt, tickNow,
                        );
                        newDepletionMm = advanceFromObservedWeather({
                            previousDepletionMm: zone.currentDepletionMm,
                            weatherDelta,
                        });
                        console.log(`daemon: zone ${zone.id} weather advance — rain=${weatherDelta.rainMm.toFixed(2)}mm, ET=${weatherDelta.etMm.toFixed(2)}mm, depletion=${zone.currentDepletionMm.toFixed(2)}→${newDepletionMm.toFixed(2)}mm.`);
                    } else {
                        console.log(`daemon: zone ${zone.id} has null currentDepletionReconciledAt — stamping ${tickNow.toISOString()} without advancing depletion.`);
                    }
                    // Hand the planner the advanced depletion so it plans
                    // from the same value we're about to persist.
                    planningZone = { ...zone, currentDepletionMm: newDepletionMm, currentDepletionReconciledAt: tickNow };
                }
                const { entries } = await runPlan(planningZone, {
                    busyWindows: [pastWindow, ...busyWindows],
                    restrictions,
                    overrides,
                    forecastDays: 14,
                });
                const { cycles } = await scheduleEntriesRepo.replaceForZone(
                    zone.id, entries, today, activeSchedule.id,
                );
                // Operator replans (isScheduledTick=false) are intentionally
                // idempotent — they plan against current state without
                // mutating it. The scheduled tick writes the reality-derived
                // depletion alongside the new reconciledAt anchor.
                if (isScheduledTick) {
                    await zonesRepo.advanceDepletion(zone.id, newDepletionMm, tickNow);
                }
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
                const alertsDb = getAlertsDb();
                await Promise.all([
                    weatherStateRepo.markFetchSuccessful(clock.now()),
                    alertsDb ? clearAlertsByClass(alertsDb, 'weather-stale') : Promise.resolve(),
                ]);
            } catch (err) {
                const reason = err instanceof Error ? err.message : String(err);
                console.error(`daemon: re-plan failed for zone ${zone.id}.`, err);
                if (await weatherStateRepo.isStale(clock.now())) {
                    await alerter({
                        class: 'weather-stale',
                        tone: 'warn',
                        title: 'Weather API stale',
                        sub: `Planner using fallback ET zero. Last fetch error: ${reason}.`,
                        zoneName: zone.name,
                    });
                }
            }
        }

        armCyclesWithScheduleMarkers(cyclesToArm, siteTimezone, ({ zone, cycle, scheduleStart, scheduleEnd }) => {
            armCycle({ clock, registry, zone, cycle, openZone, closeZone, notifier, alerter, scheduleStart, scheduleEnd });
        });

        lastRePlanAt = clock.now();
        scheduleNextRePlan();
        console.log('daemon: re-plan complete.');
    };

    const rePlan = (): Promise<void> => _rePlan(false);

    const shutdown = async (): Promise<void> => {
        console.log('daemon: shutdown starting.');
        registry.cancelAllTimers(clock);
        await closeAllInFlight({ clock, registry, closeZone, alerter });
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
 * scheduling math is unit-testable directly.
 */
export function computeNextRePlanAt(now: Date, hourLocal: number, tz: string): Date {
    const ref = dayjs(now).tz(tz);
    const todayAtHour = ref.hour(hourLocal).minute(0).second(0).millisecond(0);
    const next = todayAtHour.isAfter(ref) ? todayAtHour : todayAtHour.add(1, 'day');
    return next.toDate();
}

/**
 * Tagged cycle ready for `armCycle`. Marker fields decide whether the runtime
 * emits `schedule-begun` / `schedule-ended` after the cycle's open/close.
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
 * each group with `scheduleStart` and the latest with `scheduleEnd`.
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
