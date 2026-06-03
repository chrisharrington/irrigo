import dayjs from 'dayjs';
import type { Zone, DailyWeather, IrrigationScheduleEntry, IrrigationCycle } from '@/models';
import type { SchedulingDecision, SchedulingDecisionReason } from '@/models/decision';
import {
    isDayAllowed,
    isNightSkipped,
    type ScheduleRestrictions,
} from './restrictions';
import { clampValue, roundTo1Decimal } from './util';
import { estimateSoakMinutes } from './soak';
import { effectiveRainfall, forecastEffectiveRainfall, DEFAULT_RAIN_SKIP_LOOKAHEAD_DAYS } from './rainfall';
import { buildDecision } from './decision';

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

type PlaceIrrigationInputs = {
    date: dayjs.Dayjs;
    sunrise: dayjs.Dayjs;
    zone: Zone;
    currentDepletionMillimeters: number;
    totalAvailableWaterMillimeters: number;
    precipitationRateMillimetersPerHour: number;
    infiltrationRateMillimetersPerHour: number;
    soakTimeMinutes: number;
    busyWindowsSoFar: ReadonlyArray<BusyWindow>;
    restrictions: ScheduleRestrictions;
};

/**
 * Result of `tryPlaceIrrigationForDay`. Either cycles were `placed` (with the
 * resulting entry and a `partial` flag set when the overnight window clamped
 * the refill, API-75), or the day was `skipped` / `deferred` with the specific
 * reason — the caller persists that reason into the decisions log (API-88) and
 * carries depletion forward unchanged.
 */
type PlaceIrrigationResult =
    | { kind: 'placed'; cycles: IrrigationCycle[]; entry: IrrigationScheduleEntry; partial: boolean }
    | { kind: 'skipped' | 'deferred'; reason: SchedulingDecisionReason };

/**
 * Computes the day's irrigation block, anchored so the last cycle ends at
 * the next day's sunrise and cycles fill backward into the night. Returns a
 * `skipped` / `deferred` result when the day is disallowed or no cycles fit the
 * overnight window — callers treat that as "skip, carry depletion forward."
 *
 * The overnight window is [midnight of cycle day, sunrise of cycle day] —
 * derived from `sunrise.startOf('day')` and `sunrise`. With the API-76 anchor
 * shift, the cycle day is the day *after* the planning day, so for an evening
 * replan on Sun the block runs [Mon 00:00, Mon sunrise] — naturally in the
 * future.
 *
 * Cycle sizing uses an iterative downward retry (API-77): the closed-form
 * `maxRunTimeMinutes` gives an upper bound on N against the empty window,
 * but cross-zone busy windows can consume so much of the residual gaps that
 * the placer can't fit N cycles. The caller retries with N-1, N-2, … until
 * placement succeeds or N=0. The `actualTotalRunTime` drives the partial-
 * refill `appliedDepthMm` / `depletionAfterMm` math.
 *
 * Past-window busy intervals (those starting at the epoch) are split out
 * from cross-zone busy windows. Once the placer has produced the cycle list,
 * any cycle whose `startTime` falls before `pastWindow.end` (= `now`) is
 * dropped. In the normal evening-replan flow no cycle is dropped; the filter
 * only bites for in-flight replans (`now` lies inside the planning block).
 */
function tryPlaceIrrigationForDay(inputs: PlaceIrrigationInputs): PlaceIrrigationResult {
    const {
        date, sunrise, zone, currentDepletionMillimeters, totalAvailableWaterMillimeters,
        precipitationRateMillimetersPerHour, infiltrationRateMillimetersPerHour, soakTimeMinutes,
        busyWindowsSoFar, restrictions,
    } = inputs;

    if (!isDayAllowed(restrictions, date.isoWeekday())) {
        console.warn(`planner: zone ${zone.id} (${zone.name}): day ${date.format('YYYY-MM-DD')} (isoWeekday ${date.isoWeekday()}) disallowed by schedule restrictions — skipping irrigation.`);
        return { kind: 'skipped', reason: 'day-not-allowed' };
    }

    if (isNightSkipped(restrictions, date)) {
        console.warn(`planner: zone ${zone.id} (${zone.name}): day ${date.format('YYYY-MM-DD')} is skip-marked — skipping irrigation.`);
        return { kind: 'skipped', reason: 'operator-skip' };
    }

    const depletionBeforeIrrigation = currentDepletionMillimeters;
    const fullRefillGrossDepthMillimeters = Math.min(
        currentDepletionMillimeters / zone.irrigationEfficiency,
        totalAvailableWaterMillimeters,
    );
    const fullRefillRunTimeMinutes = (fullRefillGrossDepthMillimeters / precipitationRateMillimetersPerHour) * 60;
    const maximumCycleMinutes = infiltrationRateMillimetersPerHour > 0
        ? (infiltrationRateMillimetersPerHour / precipitationRateMillimetersPerHour) * 60
        : fullRefillRunTimeMinutes;

    // Overnight floor: midnight (00:00 local) of the irrigation entry's date.
    // No cycle may start before this time.
    const earliestStart = sunrise.startOf('day');

    // Cap runtime at what tonight's overnight window can physically hold
    // (API-75). The closed-form picks the largest N where
    // `N·maxCycle + (N-1)·soak ≤ windowMinutes`, then maxRunTime = N·maxCycle.
    // When the full-refill runtime exceeds this cap, we accept a partial
    // refill — depletionAfter reflects the residual and carries forward to
    // the next allowed day. Without this clamp, deep deficits on low-
    // infiltration soils defer forever because every full refill is longer
    // than [midnight, sunrise].
    const windowMinutes = sunrise.diff(earliestStart, 'minute');
    const maxRunTimeMinutes = computeMaxRunTimeMinutes(maximumCycleMinutes, soakTimeMinutes, windowMinutes);
    if (maxRunTimeMinutes <= 0) {
        console.warn(`planner: zone ${zone.id} (${zone.name}): overnight window (${windowMinutes} min) too short to fit even one cycle (maxCycle ${maximumCycleMinutes.toFixed(1)} min) on ${date.format('YYYY-MM-DD')} — skipping irrigation.`);
        return { kind: 'deferred', reason: 'window-too-short' };
    }
    const initialTotalRunTimeMinutes = Math.min(fullRefillRunTimeMinutes, maxRunTimeMinutes);

    // The daemon plumbs a "past window" — { start: epoch, end: now } — as a
    // busy interval that pushes past-dated cycles forward. It's handled
    // separately from real cross-zone busy windows: cross-zone windows feed
    // the backward placer (so cycles slide *earlier* into soak gaps), while
    // the past window applies as a forward shift *after* placement so a
    // past-due cycle is fired now-ish instead of dropped.
    const pastWindow = busyWindowsSoFar.find(w => w.start.valueOf() === 0);
    const crossZoneBusyWindows = pastWindow
        ? busyWindowsSoFar.filter(w => w !== pastWindow)
        : busyWindowsSoFar;

    // Iterative downward cap (API-77). The closed-form `maxRunTimeMinutes`
    // sizes against the *empty* overnight window; with earlier zones already
    // planted, the residual gaps may not fit the chosen N cycles. Try N, then
    // N-1, etc., until the placer succeeds. Shrinking N is more honest than
    // a residual-time closed form because interleaving into soak gaps fits
    // cycles when arithmetic says no. The first non-null placement wins.
    const initialN = computeInitialCycleCount(initialTotalRunTimeMinutes, maximumCycleMinutes);
    let placedCycles: IrrigationCycle[] | null = null;
    let actualTotalRunTimeMinutes = 0;
    for (let n = initialN; n >= 1; n--) {
        const candidateRunTime = candidateTotalRunTime(n, fullRefillRunTimeMinutes, maximumCycleMinutes);
        const candidatePerCycle = roundTo1Decimal(candidateRunTime / n);
        if (candidatePerCycle <= 0) continue;
        const candidate = placeCyclesBackwardAvoidingBusy(
            n,
            candidatePerCycle,
            sunrise,
            soakTimeMinutes,
            earliestStart,
            crossZoneBusyWindows,
        );
        if (candidate !== null) {
            placedCycles = candidate;
            actualTotalRunTimeMinutes = n * candidatePerCycle;
            break;
        }
    }

    if (placedCycles === null) {
        console.warn(`planner: zone ${zone.id} (${zone.name}): no cycle count from ${initialN} down fit the overnight window's residual gaps on ${date.format('YYYY-MM-DD')} — deferring irrigation.`);
        return { kind: 'deferred', reason: 'no-cycle-fit' };
    }

    if (placedCycles.length === 0) {
        console.warn(`planner: zone ${zone.id} (${zone.name}): no cycles fit the overnight window on ${date.format('YYYY-MM-DD')} — skipping irrigation.`);
        return { kind: 'deferred', reason: 'no-cycle-fit' };
    }

    const grossIrrigationDepthMillimeters = (actualTotalRunTimeMinutes / 60) * precipitationRateMillimetersPerHour;
    if (actualTotalRunTimeMinutes < fullRefillRunTimeMinutes) {
        console.log(`planner: zone ${zone.id} (${zone.name}): clamping run time ${fullRefillRunTimeMinutes.toFixed(1)} → ${actualTotalRunTimeMinutes.toFixed(1)} min on ${date.format('YYYY-MM-DD')} (window ${windowMinutes} min, ${placedCycles.length} cycle(s)); applying ${grossIrrigationDepthMillimeters.toFixed(1)} of ${fullRefillGrossDepthMillimeters.toFixed(1)} mm.`);
    }

    // Past-window handling (API-76). The block now anchors to the next day's
    // sunrise, so for an evening replan the placed cycles already sit in the
    // future. The only case where the past window matters is the in-flight
    // replan — `now` lands inside [midnight cycle-day, sunrise cycle-day] —
    // and we drop any cycle whose start has already passed. No forward shift,
    // no midnight filter, no endBySunrise drop: the new anchor already
    // guarantees `cycleEnd ≤ sunrise` and that all surviving cycles are
    // overnight by construction.
    const finalCycles = pastWindow === undefined
        ? placedCycles
        : placedCycles.filter(c => !c.startTime.isBefore(pastWindow.end));

    if (finalCycles.length === 0) {
        console.warn(`planner: zone ${zone.id} (${zone.name}): no cycles remain after past-window handling on ${date.format('YYYY-MM-DD')} — skipping irrigation.`);
        return { kind: 'deferred', reason: 'past-window' };
    }

    // Net depth that actually reaches the root zone after losses. `depletionAfter`
    // is the residual depletion after this event — zero on a full refill,
    // positive when the overnight-window clamp limited the applied gross
    // (API-75). The planner's day loop carries this residual into tomorrow.
    const netAppliedDepthMillimeters = grossIrrigationDepthMillimeters * zone.irrigationEfficiency;
    const depletionAfterIrrigation = Math.max(0, depletionBeforeIrrigation - netAppliedDepthMillimeters);

    const entry: IrrigationScheduleEntry = {
        date,
        zoneId: zone.id,
        cycles: finalCycles,
        appliedDepthMm: roundTo1Decimal(grossIrrigationDepthMillimeters),
        depletionBeforeMm: roundTo1Decimal(depletionBeforeIrrigation),
        depletionAfterMm: roundTo1Decimal(depletionAfterIrrigation),
        sunriseAt: sunrise,
    };
    // `partial` when the overnight window clamped the applied gross below a
    // full refill (API-75) — distinguishes `partial-refill` from `full-refill`
    // in the decisions log (API-88).
    return { kind: 'placed', cycles: finalCycles, entry, partial: actualTotalRunTimeMinutes < fullRefillRunTimeMinutes };
}

/**
 * Returns the largest total runtime (minutes) whose cycle layout fits inside
 * `windowMinutes` given the per-cycle infiltration cap (`maxCycleMinutes`) and
 * the intra-zone soak gap. Closed form: pick the largest `N` where
 * `N·maxCycle + (N-1)·soak ≤ windowMinutes`, then `maxRunTime = N·maxCycle`.
 * Returns 0 when not even one minimum-width cycle fits.
 *
 * For `maxCycleMinutes <= 0` (no infiltration limit), a single uninterrupted
 * cycle is allowed up to the full window — there's no per-cycle ceiling.
 *
 * Sizes against the *empty* window — API-77 wraps this in an outer downward
 * retry that shrinks N when the residual gaps after cross-zone placement
 * can't hold the closed-form plan.
 */
function computeMaxRunTimeMinutes(maxCycleMinutes: number, soakTimeMinutes: number, windowMinutes: number): number {
    if (windowMinutes <= 0) return 0;
    if (maxCycleMinutes <= 0) return windowMinutes;
    const cyclesThatFit = Math.floor((windowMinutes + soakTimeMinutes) / (maxCycleMinutes + soakTimeMinutes));
    if (cyclesThatFit <= 0) return 0;
    return cyclesThatFit * maxCycleMinutes;
}

/**
 * Returns the initial cycle count (N) the iterative downward retry should
 * start from, given a total runtime and per-cycle infiltration cap. Matches
 * the pre-API-77 placer's internal derivation: N=1 for the no-cap / single-
 * cycle case, otherwise `ceil(totalRunTime / maxCycle)`.
 */
function computeInitialCycleCount(totalRunTimeMinutes: number, maximumCycleMinutes: number): number {
    if (totalRunTimeMinutes <= 0) return 0;
    if (maximumCycleMinutes <= 0 || totalRunTimeMinutes <= maximumCycleMinutes) return 1;
    return Math.ceil(totalRunTimeMinutes / maximumCycleMinutes);
}

/**
 * Returns the candidate total runtime for `n` cycles inside the iterative
 * downward retry: capped at the full-refill runtime (no point watering past
 * a full refill) and at `n * maxCycle` (the infiltration ceiling for `n`
 * cycles). When `maxCycle <= 0` (no infiltration limit) the only cap is
 * the full refill.
 */
function candidateTotalRunTime(n: number, fullRefillRunTimeMinutes: number, maximumCycleMinutes: number): number {
    if (maximumCycleMinutes <= 0) return fullRefillRunTimeMinutes;
    return Math.min(fullRefillRunTimeMinutes, n * maximumCycleMinutes);
}


/**
 * Builds and places an irrigation cycle plan anchored so the last cycle ends
 * at sunrise, walking backward into the night. While walking, each cycle is
 * slid *earlier* past any overlapping `busyWindows` until it fits — that's
 * what lets a follow-on zone's cycles interleave into the soak gaps of an
 * earlier-planned zone instead of being shoved past sunrise (the old
 * forward-only deconflict cascaded delays and dropped most days for the
 * second zone, see API-66).
 *
 * Interleaving invariant (API-73). On overlap the cycle snaps to
 * `cycleEnd = busy.start`, so a follow-on zone's cycle ends flush against the
 * earlier zone's next start — a 0-minute inter-zone gap. Intra-zone soak is
 * preserved via `cursor`, which walks backward by `soakTimeMinutes` from each
 * placed cycle's start. Together these two rules cause a follow-on zone's
 * cycles to land inside the earlier zone's soak gaps whenever they
 * dimensionally fit, compressing the multi-zone overnight block.
 *
 * When a cycle still doesn't fit (sliding earlier would land before
 * `earliestStart` = midnight), the entire day is treated as un-irrigatable:
 * the function returns `null` so the caller defers and carries depletion
 * into the next allowed day. The caller (API-77) wraps this in an iterative
 * downward retry, calling with progressively smaller `numberOfCycles` until
 * placement succeeds.
 *
 * @param numberOfCycles - Number of cycles to lay down (chosen by the caller's
 *   downward retry). Returns `[]` when zero.
 * @param perCycleMinutes - Per-cycle duration. The caller picks this such
 *   that `numberOfCycles * perCycleMinutes` matches the desired total runtime.
 * @param sunrise - End anchor: last cycle ends here (or earlier if busy windows displace it).
 * @param soakTimeMinutes - Soak gap between consecutive cycles of this zone.
 * @param earliestStart - Hard floor: no cycle may start before this time (midnight of the entry date).
 * @param busyWindows - Intervals occupied by other zones (or the past window
 *   if handled here). Cycles slide earlier to avoid overlap.
 * @returns Cycles in chronological order (earliest first), `null` when the
 *   day must be deferred, or `[]` when `numberOfCycles === 0`.
 */
function placeCyclesBackwardAvoidingBusy(
    numberOfCycles: number,
    perCycleMinutes: number,
    sunrise: dayjs.Dayjs,
    soakTimeMinutes: number,
    earliestStart: dayjs.Dayjs,
    busyWindows: ReadonlyArray<BusyWindow>,
): IrrigationCycle[] | null {
    if (numberOfCycles <= 0 || perCycleMinutes <= 0) return [];

    const cyclesInReverse: IrrigationCycle[] = [];
    let cursor: dayjs.Dayjs = sunrise; // latest-allowed end for the next placed cycle (walking backward)

    for (let i = 0; i < numberOfCycles; i++) {
        let cycleEnd: dayjs.Dayjs = cursor;
        let cycleStart: dayjs.Dayjs = cycleEnd.subtract(perCycleMinutes, 'minute');

        // Slide earlier past any busy window we overlap. Re-iterate after each
        // shift since the new (earlier) slot may overlap a different window.
        let stable = false;
        while (!stable) {
            stable = true;
            for (const w of busyWindows) {
                if (cycleStart.isBefore(w.end) && cycleEnd.isAfter(w.start)) {
                    cycleEnd = w.start;
                    cycleStart = cycleEnd.subtract(perCycleMinutes, 'minute');
                    stable = false;
                    break;
                }
            }
        }

        if (cycleStart.isBefore(earliestStart)) {
            return null; // defer: window too short to fit the required cycles
        }

        cyclesInReverse.push({ startTime: cycleStart, durationMin: perCycleMinutes });
        cursor = cycleStart.subtract(soakTimeMinutes, 'minute');
    }

    return cyclesInReverse.reverse();
}

