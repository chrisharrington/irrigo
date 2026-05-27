import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { clearAlertsByClass, noopAlerter, type Alerter } from '@/alerts';
import {
    closeZone as defaultCloseZone,
    getZoneActuationHistory as defaultGetZoneActuationHistory,
    getZoneState as defaultGetZoneState,
    openZone as defaultOpenZone,
    type ZoneActuationInterval,
    type ZoneRelayState,
} from '@/data/home-assistant';
import { getWeatherData, sumHourlyWeatherBetween } from '@/data/weather';
import type { IrrigationScheduleEntry, WeatherData, Zone } from '@/models';
import type { PersistedCycle } from '@/models/cycle';
import { noopNotifier, type Notifier } from '@/notifications';
import { runScheduleForZone, type RunScheduleForZoneOptions } from '@/schedules';
import type { PlanZoneScheduleResult } from '@/schedules/dynamic';
import { getSystemState } from '@/service/system';
import { advanceFromObservedWeather, reconcileFromActuationHistory } from './depletion';
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
    /** Optional. Minutes after sunrise at which the morning reconciliation tick fires. Default 60. */
    morningTickMinutesAfterSunrise?: number;
    runPlan?: (zone: Zone, options?: RunScheduleForZoneOptions) => Promise<PlanZoneScheduleResult>;
    /**
     * Reads weather (daily + hourly) for a zone. Defaulted to the real
     * `getWeatherData`. Injected separately from `runPlan` so the daemon can
     * advance depletion against observed hourly weather without the planner
     * having to plumb the hourly array through `PlanZoneScheduleResult`.
     */
    getWeather?: (zone: Zone) => Promise<WeatherData>;
    /**
     * Reads the on/off intervals during which `zone.homeAssistantEntityId`
     * was energized in `[since, until)`. Defaulted to the real HA call.
     * Used by the morning tick to ground depletion advance in actual relay
     * runtime rather than the planner's projection.
     */
    getZoneActuationHistory?: (zone: Zone, since: Date, until: Date) => Promise<ZoneActuationInterval[]>;
    openZone?: (zone: Zone) => Promise<void>;
    closeZone?: (zone: Zone) => Promise<void>;
    getZoneState?: (zone: Zone) => Promise<ZoneRelayState>;
    clock?: Clock;
    siteTimezone?: string;
    notifier?: Notifier;
    alerter?: Alerter;
};

/**
 * Distinguishes the daemon's two scheduled ticks. The morning tick
 * (~sunrise+60min) reconciles depletion against actual HA actuation history
 * for the prior night; the evening tick (20:00 local) advances depletion
 * through the day's observed weather and forward-plans tonight's cycles.
 */
type TickKind = 'morning' | 'evening';

const DEFAULT_MORNING_TICK_MINUTES_AFTER_SUNRISE = 60;

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
    const morningTickMinutesAfterSunrise = options?.morningTickMinutesAfterSunrise ?? DEFAULT_MORNING_TICK_MINUTES_AFTER_SUNRISE;
    const runPlan = options?.runPlan ?? ((zone, opts) => runScheduleForZone(zone, opts));
    const getWeather = options?.getWeather ?? (async (zone: Zone): Promise<WeatherData> => {
        if (!zone.location) throw new Error(`daemon: zone ${zone.id} has no location; cannot fetch weather.`);
        return getWeatherData({
            latitude: zone.location.lat,
            longitude: zone.location.lon,
            timezone: zone.siteTimezone,
        });
    });
    const getZoneActuationHistory = options?.getZoneActuationHistory ?? defaultGetZoneActuationHistory;
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

    // Most-recently-observed sunrise instant in the site's timezone. Seeded
    // by a boot-time weather fetch (cache-friendly — the first per-zone
    // _rePlan call shares the cache) so the first scheduleNextTick can pick
    // between morning and evening. Updated inside _rePlan on every
    // subsequent successful weather fetch.
    let latestKnownSunrise: Date | null = null;

    // Picks the soonest sunrise from a `daily` array whose `sunrise+offset`
    // is still in the future relative to `at`. Returns null if no entry
    // qualifies (e.g. the last day of the horizon already morning-ticked).
    const pickUpcomingSunrise = (daily: ReadonlyArray<{ sunrise?: dayjs.Dayjs }>, at: Date): Date | null => {
        const thresholdMs = at.getTime() - morningTickMinutesAfterSunrise * 60_000;
        for (const day of daily) {
            const candidate = day.sunrise?.toDate();
            if (candidate && candidate.getTime() > thresholdMs) return candidate;
        }
        return null;
    };

    // Boot weather fetch — seeds latestKnownSunrise so the first
    // scheduleNextTick can pick a morning tick. Fire-and-forget tolerance:
    // if the fetch fails, the daemon still boots and schedules an evening
    // tick; the next successful fetch (per-zone, inside _rePlan) repopulates
    // the anchor.
    const bootSeedZone = enabledZonesAtBoot.find(z => z.location !== undefined);
    if (bootSeedZone) {
        try {
            const bootWeather = await getWeather(bootSeedZone);
            latestKnownSunrise = pickUpcomingSunrise(bootWeather.daily, clock.now());
            console.log(`daemon: boot weather fetch ok — latestKnownSunrise=${latestKnownSunrise?.toISOString() ?? 'null'}.`);
        } catch (err) {
            console.warn(`daemon: boot weather fetch failed; morning tick will be scheduled after the first successful in-tick fetch.`, err);
        }
    }

    const scheduleNextTick = (): void => {
        const now = clock.now();
        const nextEvening = computeNextRePlanAt(now, rePlanHourLocal, siteTimezone);
        const nextMorning = computeNextMorningAt(now, latestKnownSunrise, morningTickMinutesAfterSunrise);
        const next = nextMorning !== null && nextMorning.getTime() < nextEvening.getTime() ? nextMorning : nextEvening;
        const kind: TickKind = next === nextMorning ? 'morning' : 'evening';
        const delay = Math.max(0, next.getTime() - now.getTime());
        console.log(`daemon: next tick (${kind}) scheduled at ${next.toISOString()} (${delay}ms from now).`);
        const handle = clock.setTimeout(() => {
            _rePlan(kind, true).catch(err => {
                console.error('daemon: unhandled error in scheduled re-plan.', err);
            });
        }, delay);
        registry.setRePlanHandle(handle);
    };

    // Private implementation. `isScheduledTick` distinguishes the nightly
    // daemon-scheduled re-plan (which writes a reality-derived depletion via
    // the morning HA-history or evening observed-weather path, see API-79)
    // from operator-triggered replans (idempotent, no zone mutation; see
    // API-71). `tickKind` selects morning vs. evening math.
    const _rePlan = async (tickKind: TickKind, isScheduledTick: boolean): Promise<void> => {
        console.log(`daemon: re-plan starting (kind=${tickKind}, scheduled=${isScheduledTick}).`);
        registry.cancelOpenTimers(clock);

        const system = await getSystemState();
        const irrigationEnabled = system.irrigationEnabled;
        if (!irrigationEnabled) {
            console.warn(`daemon: planning suppressed — system irrigation is disabled (since ${system.since}). Depletion reconciliation still runs so the model stays accurate while watering is paused.`);
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

            try {
                // Reality-derived depletion advance. Morning ticks reconcile
                // against actual HA actuation history (subtracts applied
                // depth); evening ticks advance through observed weather only
                // (no irrigation has fired since the morning anchor). A null
                // reconciledAt (fresh seed) is stamped without math — first
                // tick calibrates the clock, subsequent ticks roll forward.
                // See API-79.
                const tickNow = clock.now();
                const weather = await getWeather(zone);
                // Refresh the morning-tick anchor with the soonest upcoming
                // sunrise still inside the offset window.
                const upcoming = pickUpcomingSunrise(weather.daily, tickNow);
                if (upcoming) latestKnownSunrise = upcoming;

                let newDepletionMm = zone.currentDepletionMm;
                if (isScheduledTick) {
                    if (zone.currentDepletionReconciledAt) {
                        const weatherDelta = sumHourlyWeatherBetween(
                            weather.hourly, zone.currentDepletionReconciledAt, tickNow,
                        );
                        if (tickKind === 'morning') {
                            let history: ZoneActuationInterval[] = [];
                            try {
                                history = await getZoneActuationHistory(zone, zone.currentDepletionReconciledAt, tickNow);
                            } catch (err) {
                                const reason = err instanceof Error ? err.message : String(err);
                                console.error(`daemon: HA actuation history fetch failed for zone ${zone.id}; falling through to weather-only advance.`, err);
                                await alerter({
                                    class: 'actuation-stale',
                                    tone: 'warn',
                                    title: 'HA actuation history stale',
                                    sub: `Depletion advanced from weather only. Last fetch error: ${reason}.`,
                                    zoneId: zone.id,
                                    zoneName: zone.name,
                                });
                            }
                            const result = reconcileFromActuationHistory({
                                previousDepletionMm: zone.currentDepletionMm,
                                weatherDelta,
                                history,
                                precipitationRateMmPerHr: zone.precipitationRateMmPerHr,
                            });
                            newDepletionMm = result.newDepletionMm;
                            console.log(`daemon: zone ${zone.id} morning reconcile — rain=${weatherDelta.rainMm.toFixed(2)}mm, ET=${weatherDelta.etMm.toFixed(2)}mm, applied=${result.appliedDepthMm.toFixed(2)}mm, depletion=${zone.currentDepletionMm.toFixed(2)}→${newDepletionMm.toFixed(2)}mm.`);
                        } else {
                            newDepletionMm = advanceFromObservedWeather({
                                previousDepletionMm: zone.currentDepletionMm,
                                weatherDelta,
                            });
                            console.log(`daemon: zone ${zone.id} evening weather advance — rain=${weatherDelta.rainMm.toFixed(2)}mm, ET=${weatherDelta.etMm.toFixed(2)}mm, depletion=${zone.currentDepletionMm.toFixed(2)}→${newDepletionMm.toFixed(2)}mm.`);
                        }
                    } else {
                        console.log(`daemon: zone ${zone.id} has null currentDepletionReconciledAt — stamping ${tickNow.toISOString()} without advancing depletion.`);
                    }
                    // Persist the reality-derived depletion + the new anchor
                    // immediately. Planning runs afterward; if it skips (kill
                    // switch off, no active schedule), the reconciliation
                    // still landed.
                    await zonesRepo.advanceDepletion(zone.id, newDepletionMm, tickNow);
                }

                // Successful weather fetch — refresh the staleness timestamp
                // and clear any lingering unacked weather-stale alert.
                const alertsDb = getAlertsDb();
                await Promise.all([
                    weatherStateRepo.markFetchSuccessful(clock.now()),
                    alertsDb ? clearAlertsByClass(alertsDb, 'weather-stale') : Promise.resolve(),
                ]);

                // Planning + arming portion. Skipped when irrigation is
                // disabled (kill switch off) or the zone's site has no
                // active schedule.
                if (!irrigationEnabled) continue;
                if (!activeSchedule) {
                    console.warn(`daemon: no active schedule for site ${zone.siteId} — skipping plan/arm of zone ${zone.id} (${zone.name}).`);
                    continue;
                }

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
                const planningZone = isScheduledTick
                    ? { ...zone, currentDepletionMm: newDepletionMm, currentDepletionReconciledAt: tickNow }
                    : zone;
                const { entries } = await runPlan(planningZone, {
                    busyWindows: [pastWindow, ...busyWindows],
                    restrictions,
                    overrides,
                    forecastDays: 14,
                });
                const { cycles } = await scheduleEntriesRepo.replaceForZone(
                    zone.id, entries, today, activeSchedule.id,
                );
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
        scheduleNextTick();
        console.log('daemon: re-plan complete.');
    };

    // Operator rePlan() invokes the evening forward-plan path. The morning
    // tick is purely a daemon-scheduled reconciliation; there's no operator
    // affordance to trigger it manually (it has no useful idempotent
    // semantics — actuation history is whatever HA reports).
    const rePlan = (): Promise<void> => _rePlan('evening', false);

    const shutdown = async (): Promise<void> => {
        console.log('daemon: shutdown starting.');
        registry.cancelAllTimers(clock);
        await closeAllInFlight({ clock, registry, closeZone, alerter });
        console.log('daemon: shutdown complete.');
    };

    scheduleNextTick();
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
 * Returns `sunrise + offsetMinutes` if that instant is still in the future
 * relative to `now`; otherwise `null`. Used by `scheduleNextTick` to pick
 * between the morning reconciliation tick and the evening forward-plan tick.
 * When the latest known sunrise has already passed (or no sunrise has been
 * observed yet), the daemon falls back to scheduling the evening tick only,
 * and the next successful weather fetch refreshes the morning anchor.
 */
export function computeNextMorningAt(now: Date, sunrise: Date | null, offsetMinutes: number): Date | null {
    if (sunrise === null) return null;
    const candidate = new Date(sunrise.getTime() + offsetMinutes * 60_000);
    if (candidate.getTime() <= now.getTime()) return null;
    return candidate;
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
