import dayjs from 'dayjs';
import { clearAlertsByClass, type Alerter, type AlertsDb } from '@/alerts';
import {
    type ZoneActuationInterval,
} from '@/data/home-assistant';
import { sumHourlyWeatherBetween } from '@/data/weather';
import type { WeatherData, Zone } from '@/models';
import type { PersistedCycle } from '@/models/cycle';
import type { ScheduleEntriesRepository } from '@/repositories/schedule-entries';
import type { Schedule } from '@/repositories/schedules';
import type { WeatherSnapshotsRepository } from '@/repositories/weather-snapshots';
import type { WeatherStateRepository } from '@/repositories/weather-state';
import type { ZonesRepository } from '@/repositories/zones';
import type { RunScheduleForZoneOptions } from '@/schedules';
import type { PlanZoneScheduleResult } from '@/schedules/dynamic';
import { advanceFromObservedWeather, reconcileFromActuationHistory } from '../depletion';
import type { Clock } from '../runtime';
import { pickUpcomingSunrise, type TickKind } from '../scheduling';

/**
 * Dependencies consumed by `runTickForZone`. Mirrors the injection seams in
 * `DaemonOptions` plus the repository handles the daemon resolves at boot.
 * Pulled into a single object so the per-zone tick body has one parameter
 * for collaborators rather than a wide positional list.
 */
export type TickDeps = {
    clock: Clock;
    alerter: Alerter;
    runPlan: (zone: Zone, options?: RunScheduleForZoneOptions) => Promise<PlanZoneScheduleResult>;
    getWeather: (zone: Zone) => Promise<WeatherData>;
    getZoneActuationHistory: (zone: Zone, since: Date, until: Date) => Promise<ZoneActuationInterval[]>;
    zonesRepo: ZonesRepository;
    scheduleEntriesRepo: ScheduleEntriesRepository;
    weatherStateRepo: WeatherStateRepository;
    weatherSnapshotsRepo: WeatherSnapshotsRepository;
    getAlertsDb: () => AlertsDb | null;
};

export type RunTickForZoneInput = {
    zone: Zone;
    /**
     * Active schedule for the zone's site, or `undefined` if no schedule is
     * active. When undefined, reconciliation still runs (depletion accuracy
     * doesn't depend on a schedule) but the planning + arming portion is
     * skipped.
     */
    activeSchedule: Schedule | undefined;
    today: dayjs.Dayjs;
    /**
     * Busy windows already reserved by earlier zones in this tick (plus the
     * pre-tick in-flight cycles). The planner shifts conflicting cycles
     * forward; cycles that still overlap are dropped from arming.
     */
    busyWindows: ReadonlyArray<{ start: Date; end: Date }>;
    /** Epoch → now window, prepended to busyWindows when calling runPlan. */
    pastWindow: { start: Date; end: Date };
    tickKind: TickKind;
    isScheduledTick: boolean;
    irrigationEnabled: boolean;
    morningTickMinutesAfterSunrise: number;
    deps: TickDeps;
};

/**
 * Outcome of a single zone's tick. The caller appends `cyclesToArm` and
 * `newBusyWindows` to its accumulators, and updates `latestKnownSunrise` if
 * `observedSunrise` is non-null. Returning rather than mutating shared state
 * keeps the function easy to unit-test.
 */
export type RunTickForZoneResult = {
    cyclesToArm: Array<{ zone: Zone; cycle: PersistedCycle }>;
    newBusyWindows: Array<{ start: Date; end: Date }>;
    observedSunrise: Date | null;
};

const EMPTY_RESULT: RunTickForZoneResult = { cyclesToArm: [], newBusyWindows: [], observedSunrise: null };

/**
 * Runs one zone's body of the daemon's `_rePlan`: fetches weather, reconciles
 * depletion against the morning or evening source of truth, persists the new
 * depletion (only on scheduled ticks), then plans and replaces schedule
 * entries when irrigation is enabled. Caller is responsible for arming the
 * returned `cyclesToArm` after iterating every zone.
 *
 * Exceptions from `getWeather` (or anything else inside the try) are caught
 * here: a `weather-stale` alert fires if the weather-state repo says the last
 * successful fetch is stale, and the function returns an empty result. The
 * daemon loop continues with the next zone.
 *
 * @returns Cycles to arm + busy-window contributions + the observed sunrise
 *   (for the caller to update its morning-tick anchor).
 */
export async function runTickForZone(input: RunTickForZoneInput): Promise<RunTickForZoneResult> {
    const {
        zone, activeSchedule, today, busyWindows, pastWindow,
        tickKind, isScheduledTick, irrigationEnabled,
        morningTickMinutesAfterSunrise, deps,
    } = input;
    const { clock, alerter, runPlan, getWeather, getZoneActuationHistory, zonesRepo, scheduleEntriesRepo, weatherStateRepo, weatherSnapshotsRepo, getAlertsDb } = deps;

    const tickNow = clock.now();
    let observedSunrise: Date | null = null;
    let weather: WeatherData;
    try {
        weather = await getWeather(zone);
    } catch (err) {
        await emitWeatherStaleIfStale(err, zone, weatherStateRepo, alerter, clock);
        return EMPTY_RESULT;
    }

    // Persist the fetched forecast for scheduling retrospectives — best-effort,
    // so a snapshot-write failure never stops reconciliation or planning. Only
    // when the zone has coordinates (it must, to have fetched weather). API-87.
    if (zone.location) {
        try {
            await weatherSnapshotsRepo.record({
                zoneId: zone.id,
                latitude: zone.location.lat,
                longitude: zone.location.lon,
                timezone: zone.siteTimezone,
                fetchedAt: tickNow,
                weather,
            });
        } catch (err) {
            console.error(`daemon: failed to persist weather snapshot for zone ${zone.id} (${zone.name}); continuing.`, err);
        }
    }

    // Refresh the morning-tick anchor with the soonest upcoming sunrise
    // still inside the offset window.
    observedSunrise = pickUpcomingSunrise(weather.daily, tickNow, morningTickMinutesAfterSunrise);

    let newDepletionMm = zone.currentDepletionMm;
    try {
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
            // immediately. Planning runs afterward; if it skips (kill switch
            // off, no active schedule), the reconciliation still landed.
            await zonesRepo.advanceDepletion(zone.id, newDepletionMm, tickNow);
        }

        // Successful weather fetch — refresh the staleness timestamp and
        // clear any lingering unacked weather-stale alert.
        const alertsDb = getAlertsDb();
        await Promise.all([
            weatherStateRepo.markFetchSuccessful(clock.now()),
            alertsDb ? clearAlertsByClass(alertsDb, 'weather-stale') : Promise.resolve(),
        ]);

        // Planning + arming portion. Skipped when irrigation is disabled
        // (kill switch off) or the zone's site has no active schedule.
        if (!irrigationEnabled) return { cyclesToArm: [], newBusyWindows: [], observedSunrise };
        if (!activeSchedule) {
            console.warn(`daemon: no active schedule for site ${zone.siteId} — skipping plan/arm of zone ${zone.id} (${zone.name}).`);
            return { cyclesToArm: [], newBusyWindows: [], observedSunrise };
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

        const cyclesToArm: Array<{ zone: Zone; cycle: PersistedCycle }> = [];
        const newBusyWindows: Array<{ start: Date; end: Date }> = [];
        for (const cycle of cycles) {
            const cycleEnd = new Date(cycle.startTime.getTime() + cycle.durationMin * 60_000);
            const window = { start: cycle.startTime, end: cycleEnd };
            const overlaps = busyWindows.some(w => cycle.startTime < w.end && cycleEnd > w.start)
                || newBusyWindows.some(w => cycle.startTime < w.end && cycleEnd > w.start);
            if (overlaps) {
                console.warn(`daemon: cycle ${cycle.id} for zone ${zone.id} (${zone.name}) overlaps a busy window — not arming.`);
                continue;
            }
            cyclesToArm.push({ zone, cycle });
            newBusyWindows.push(window);
        }
        return { cyclesToArm, newBusyWindows, observedSunrise };
    } catch (err) {
        await emitWeatherStaleIfStale(err, zone, weatherStateRepo, alerter, clock);
        return { cyclesToArm: [], newBusyWindows: [], observedSunrise };
    }
}

async function emitWeatherStaleIfStale(
    err: unknown,
    zone: Zone,
    weatherStateRepo: WeatherStateRepository,
    alerter: Alerter,
    clock: Clock,
): Promise<void> {
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
