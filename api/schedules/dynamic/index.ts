import type dayjs from 'dayjs';
import type { Zone, DailyWeather, IrrigationScheduleEntry } from '@/models';
import type { SchedulingDecision } from '@/models/decision';
import type { ScheduleRestrictions } from './restrictions';
import { clampValue } from './util';
import { estimateSoakMinutes } from './soak';
import { effectiveRainfall, forecastEffectiveRainfall, DEFAULT_RAIN_SKIP_LOOKAHEAD_DAYS } from './rainfall';
import { buildDecision } from './decision';
import { tryPlaceIrrigationForDay } from './placement';

// Re-exported so `@/schedules/dynamic`'s public surface is unchanged (consumed
// by `@/schedules` + tests). The definition now lives in `./rainfall`.
export { DEFAULT_RAIN_SKIP_LOOKAHEAD_DAYS };

const NO_RESTRICTIONS: ScheduleRestrictions = { allowedDays: null, allowedTimeWindows: null };

/**
 * Per-schedule planner overrides. When set, the planner uses these values
 * in place of the corresponding zone fields. Both null/undefined means
 * "no override" — planner reads `zone.rootDepthM` and
 * `zone.allowableDepletionFraction` as before.
 */
export type ScheduleOverrides = {
    rootDepthM?: number;
    allowableDepletionFraction?: number;
};

const NO_OVERRIDES: ScheduleOverrides = {};

/**
 * A time interval the planner must avoid placing cycles inside. Used by the
 * daemon's sequential per-zone planning to prevent cross-zone overlap: each
 * zone's persisted cycles become busy windows for subsequent zones.
 */
export type BusyWindow = {
    start: dayjs.Dayjs;
    end: dayjs.Dayjs;
};

/**
 * Result of `planZoneSchedule`. `entries` is the per-day irrigation plan;
 * `projectedNextDepletionMm` is the running soil-moisture depletion at the
 * end of day 0 of the planning horizon — i.e. the value the next morning's
 * re-plan should treat as 'now' when it kicks off. Persisting this value
 * back to `zones.current_depletion_mm` is what keeps day-N planning honest.
 */
export type PlanZoneScheduleResult = {
    entries: IrrigationScheduleEntry[];
    projectedNextDepletionMm: number;

    /**
     * The planner's decision for day 0 of the horizon — i.e. *tonight's*
     * decision (watered / skipped / deferred + reason + depletion + threshold).
     * The daemon persists it into `scheduling_decisions` for retrospectives.
     * Undefined when no day was evaluated (empty forecast, or the zone is
     * disabled and planning short-circuited). API-88.
     */
    decision?: SchedulingDecision;
};

/**
 * Plan irrigation schedule for a zone based on weather history.
 * Uses soil moisture balance to determine when irrigation is needed.
 *
 * @param zone - The irrigation zone configuration.
 * @param weatherHistory - Array of daily weather data.
 * @param busyWindows - Time intervals already occupied by other zones'
 *   cycles. Cycles whose preferred placement (per `buildCyclePlan`) would
 *   overlap a busy window are shifted forward until they fit. Defaults to
 *   empty for first-zone-in-the-batch / standalone planning calls.
 * @param restrictions - Per-schedule day/time-window constraints. When a
 *   day is disallowed or the planned irrigation block can't fit any allowed
 *   window, the day's cycles are dropped (with a warning) and depletion
 *   carries forward into the next allowed day. Defaults to "no restriction".
 * @param overrides - Per-schedule planner-parameter overrides. When set,
 *   the planner uses these in place of the zone's own `rootDepthM` /
 *   `allowableDepletionFraction`. Zone rows stay untouched — overrides
 *   express the temporary planning mode (e.g. overseeding vs. maintenance).
 * @param rainSkipLookaheadDays - Forecast horizon (days, starting tomorrow)
 *   for the rain-skip. When forecast effective rain over this window would by
 *   itself bring depletion below the trigger, the night is deferred. 0 disables
 *   the rain-skip. Defaults to `DEFAULT_RAIN_SKIP_LOOKAHEAD_DAYS`; the daemon
 *   sources it from the `RAIN_SKIP_LOOKAHEAD_DAYS` env var. API-85.
 * @returns Per-day entries plus the projected next-day starting depletion.
 */
export function planZoneSchedule(
    zone: Zone,
    weatherHistory: DailyWeather[],
    busyWindows: ReadonlyArray<BusyWindow> = [],
    restrictions: ScheduleRestrictions = NO_RESTRICTIONS,
    overrides: ScheduleOverrides = NO_OVERRIDES,
    rainSkipLookaheadDays: number = DEFAULT_RAIN_SKIP_LOOKAHEAD_DAYS,
): PlanZoneScheduleResult {
    const effectiveRootDepthM = overrides.rootDepthM ?? zone.rootDepthM,
        effectiveAllowableDepletionFraction = overrides.allowableDepletionFraction ?? zone.allowableDepletionFraction;

    if (overrides.rootDepthM !== undefined || overrides.allowableDepletionFraction !== undefined) {
        console.log(`planZoneSchedule: zone ${zone.id} using overrides root=${effectiveRootDepthM} depletion=${effectiveAllowableDepletionFraction}.`);
    }

    const totalAvailableWaterMillimetersForClamp = zone.soil.availableWaterHoldingCapacityMmPerM * effectiveRootDepthM,
        clampedStartingDepletion = clampValue(zone.currentDepletionMm ?? 0, 0, totalAvailableWaterMillimetersForClamp);

    if (zone.isEnabled === false) return { entries: [], projectedNextDepletionMm: clampedStartingDepletion };

    // Calculate soil water holding capacity and thresholds.
    const availableWaterHoldingCapacity = zone.soil.availableWaterHoldingCapacityMmPerM,
        totalAvailableWaterMillimeters = availableWaterHoldingCapacity * effectiveRootDepthM,
        readilyAvailableWaterMillimeters = effectiveAllowableDepletionFraction * totalAvailableWaterMillimeters;

    // Calculate precipitation rate from flow rate and area (1 L/m² = 1 mm).
    const precipitationRateMillimetersPerHour = zone.precipitationRateMmPerHr ?? 60 * (zone.flowRateLPerMin / zone.areaM2);

    // Determine infiltration rate and soak time between cycles.
    const infiltrationRateMillimetersPerHour = zone.soil.infiltrationRateMmPerHr,
        soakTimeMinutes = estimateSoakMinutes(infiltrationRateMillimetersPerHour);

    // Initialize current soil moisture depletion.
    let currentDepletionMillimeters = clampedStartingDepletion;
    let projectedNextDepletionMm = clampedStartingDepletion;

    // The decision the planner reaches for day 0 of the horizon — tonight's
    // outcome. Captured for `scheduling_decisions` so retrospectives can see
    // why a night went the way it did (API-88). Stays undefined for an empty
    // forecast.
    let day0Decision: SchedulingDecision | undefined;

    const irrigationSchedule: IrrigationScheduleEntry[] = [];

    // Running set of intervals this zone (and any earlier zones in the batch)
    // have committed to. Each placed cycle is appended so subsequent cycles
    // — both within this zone's later days and within the same day's
    // multi-cycle plan — see them as occupied.
    const busyWindowsSoFar: BusyWindow[] = [...busyWindows];

    // Process each day of weather history.
    for (const [dayIndex, weatherDay] of weatherHistory.entries()) {
        const date = weatherDay.date;

        // Calculate crop evapotranspiration and effective rainfall.
        const referenceEvapotranspiration = Math.max(0, weatherDay.evapotranspirationMmPerDay ?? 0),
            cropCoefficient = zone.grassType.cropCoefficient,
            microclimateFactor = zone.microclimateFactor ?? 1,
            cropEvapotranspiration = cropCoefficient * microclimateFactor * referenceEvapotranspiration,
            rainfallMillimeters = weatherDay.rainfallMm ?? 0,
            effectiveRainfallMillimeters = effectiveRainfall(rainfallMillimeters);

        // Update soil depletion based on ET and rainfall.
        currentDepletionMillimeters = clampValue(
            currentDepletionMillimeters + cropEvapotranspiration - effectiveRainfallMillimeters,
            0,
            totalAvailableWaterMillimeters
        );

        // The decision reached for this day. Only day 0's is surfaced on the
        // result, but it's built uniformly in every branch so the logic stays
        // in one place. API-88.
        let decision: SchedulingDecision;

        // Check if irrigation is needed.
        if (currentDepletionMillimeters >= readilyAvailableWaterMillimeters) {
            // Forward-looking rain-skip (API-85). Before committing tonight's
            // cycles, look ahead at the forecast: if the effective rainfall over
            // the next few days would by itself bring depletion back below the
            // trigger, skip tonight and carry depletion forward. Watering now
            // would only refill the soil for the rain to overflow — pure waste.
            // The daemon re-plans every evening, so this skip is reconsidered
            // tomorrow if the forecast rain doesn't arrive.
            const upcomingEffectiveRainfallMillimeters = forecastEffectiveRainfall(weatherHistory, dayIndex, rainSkipLookaheadDays);
            const rainWillCoverDeficit = currentDepletionMillimeters - upcomingEffectiveRainfallMillimeters < readilyAvailableWaterMillimeters;

            if (rainWillCoverDeficit) {
                console.log(`planner: zone ${zone.id} (${zone.name}): rain-skip on ${date.format('YYYY-MM-DD')} — depletion ${currentDepletionMillimeters.toFixed(1)} mm ≥ trigger ${readilyAvailableWaterMillimeters.toFixed(1)} mm, but ${upcomingEffectiveRainfallMillimeters.toFixed(1)} mm effective rain forecast over the next ${rainSkipLookaheadDays} day(s) will bring it below trigger — deferring irrigation.`);
                // Fall through: depletion carries forward unchanged and the
                // day-0 projection is still captured below.
                decision = buildDecision(date, 'skipped', 'rain-forecast', currentDepletionMillimeters, currentDepletionMillimeters, readilyAvailableWaterMillimeters);
            } else {
                // Anchor each planning day's overnight block to the *next* day's
                // sunrise — i.e. the block runs [midnight day i+1, sunrise day i+1],
                // the overnight starting tonight and ending tomorrow morning. The
                // last day of the horizon has no successor and is therefore dropped
                // (no anchor). See API-76.
                const nextDay = weatherHistory[dayIndex + 1];
                if (nextDay === undefined) {
                    console.warn(`planner: zone ${zone.id} (${zone.name}): day ${date.format('YYYY-MM-DD')} is the last weather day — no next-day sunrise to anchor to, deferring irrigation.`);
                    decision = buildDecision(date, 'deferred', 'no-anchor', currentDepletionMillimeters, currentDepletionMillimeters, readilyAvailableWaterMillimeters);
                } else {
                    const sunrise = nextDay.sunrise ?? nextDay.date.hour(6).minute(0).second(0).millisecond(0);

                    const irrigationOutcome = tryPlaceIrrigationForDay({
                        date,
                        sunrise,
                        zone,
                        currentDepletionMillimeters,
                        totalAvailableWaterMillimeters,
                        precipitationRateMillimetersPerHour,
                        infiltrationRateMillimetersPerHour,
                        soakTimeMinutes,
                        busyWindowsSoFar,
                        restrictions,
                    });

                    if (irrigationOutcome.kind === 'placed') {
                        // Each placed cycle becomes a busy window for the rest of
                        // the planning horizon.
                        for (const cycle of irrigationOutcome.cycles) {
                            busyWindowsSoFar.push({
                                start: cycle.startTime,
                                end: cycle.startTime.add(cycle.durationMin, 'minute'),
                            });
                        }

                        irrigationSchedule.push(irrigationOutcome.entry);

                        // Start the post-irrigation portion from the entry's residual
                        // depletion (zero on a full refill, positive on a partial
                        // refill clamped by the overnight window — see API-75), then
                        // re-apply the day's net ET for the post-irrigation hours.
                        currentDepletionMillimeters = clampValue(
                            irrigationOutcome.entry.depletionAfterMm + cropEvapotranspiration - effectiveRainfallMillimeters,
                            0,
                            totalAvailableWaterMillimeters
                        );

                        decision = buildDecision(
                            date,
                            'watered',
                            irrigationOutcome.partial ? 'partial-refill' : 'full-refill',
                            irrigationOutcome.entry.depletionBeforeMm,
                            irrigationOutcome.entry.depletionAfterMm,
                            readilyAvailableWaterMillimeters,
                        );
                    } else {
                        // The day was skipped or deferred (restriction, window
                        // too short, no cycle count fit, …). Depletion carries
                        // forward unchanged — the next allowed day will see the
                        // larger accumulated value.
                        decision = buildDecision(date, irrigationOutcome.kind, irrigationOutcome.reason, currentDepletionMillimeters, currentDepletionMillimeters, readilyAvailableWaterMillimeters);
                    }
                }
            }
        } else {
            decision = buildDecision(date, 'skipped', 'below-threshold', currentDepletionMillimeters, currentDepletionMillimeters, readilyAvailableWaterMillimeters);
        }

        // Ensure depletion stays within valid bounds.
        currentDepletionMillimeters = clampValue(currentDepletionMillimeters, 0, totalAvailableWaterMillimeters);

        // Capture the projected end-of-day-0 depletion — this becomes the
        // starting depletion that tomorrow's re-plan should treat as 'now' —
        // and the day-0 decision the daemon will persist.
        if (dayIndex === 0) {
            projectedNextDepletionMm = currentDepletionMillimeters;
            day0Decision = decision;
        }
    }

    return { entries: irrigationSchedule, projectedNextDepletionMm, decision: day0Decision };
}
