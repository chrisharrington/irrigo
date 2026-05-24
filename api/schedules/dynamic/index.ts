import dayjs from 'dayjs';
import type { Zone, DailyWeather, IrrigationScheduleEntry, IrrigationCycle } from '@/models';
import {
    isDayAllowed,
    isNightSkipped,
    type ScheduleRestrictions,
} from './restrictions';

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
 * @returns Per-day entries plus the projected next-day starting depletion.
 */
export function planZoneSchedule(
    zone: Zone,
    weatherHistory: DailyWeather[],
    busyWindows: ReadonlyArray<BusyWindow> = [],
    restrictions: ScheduleRestrictions = NO_RESTRICTIONS,
    overrides: ScheduleOverrides = NO_OVERRIDES,
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

    const irrigationSchedule: IrrigationScheduleEntry[] = [];

    // Running set of intervals this zone (and any earlier zones in the batch)
    // have committed to. Each placed cycle is appended so subsequent cycles
    // — both within this zone's later days and within the same day's
    // multi-cycle plan — see them as occupied.
    const busyWindowsSoFar: BusyWindow[] = [...busyWindows];

    // Process each day of weather history.
    for (const [dayIndex, weatherDay] of weatherHistory.entries()) {
        const date = weatherDay.date,
            sunrise = weatherDay.sunrise ?? date.hour(6).minute(0).second(0);

        // Calculate crop evapotranspiration and effective rainfall.
        const referenceEvapotranspiration = Math.max(0, weatherDay.evapotranspirationMmPerDay ?? 0),
            cropCoefficient = zone.grassType.cropCoefficient,
            microclimateFactor = zone.microclimateFactor ?? 1,
            cropEvapotranspiration = cropCoefficient * microclimateFactor * referenceEvapotranspiration,
            rainfallMillimeters = weatherDay.rainfallMm ?? 0,
            effectiveRainfallMillimeters = rainfallMillimeters < 2 ? 0 : 0.8 * rainfallMillimeters; // If rainfall is less than 2mm, treat as zero.

        // Update soil depletion based on ET and rainfall.
        currentDepletionMillimeters = clampValue(
            currentDepletionMillimeters + cropEvapotranspiration - effectiveRainfallMillimeters,
            0,
            totalAvailableWaterMillimeters
        );

        // Check if irrigation is needed.
        if (currentDepletionMillimeters >= readilyAvailableWaterMillimeters) {
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

            if (irrigationOutcome !== null) {
                // Each placed cycle becomes a busy window for the rest of
                // the planning horizon.
                for (const cycle of irrigationOutcome.cycles) {
                    busyWindowsSoFar.push({
                        start: cycle.startTime,
                        end: cycle.startTime.add(cycle.durationMin, 'minute'),
                    });
                }

                irrigationSchedule.push(irrigationOutcome.entry);

                // Reset depletion to zero after irrigation, then re-apply
                // the day's net ET for the post-irrigation portion.
                currentDepletionMillimeters = clampValue(
                    cropEvapotranspiration - effectiveRainfallMillimeters,
                    0,
                    totalAvailableWaterMillimeters
                );
            }
            // When `irrigationOutcome === null`, the day was skipped due to
            // restrictions. Depletion carries forward unchanged — the next
            // allowed day will see the larger accumulated value.
        }

        // Ensure depletion stays within valid bounds.
        currentDepletionMillimeters = clampValue(currentDepletionMillimeters, 0, totalAvailableWaterMillimeters);

        // Capture the projected end-of-day-0 depletion — this becomes the
        // starting depletion that tomorrow's re-plan should treat as 'now'.
        if (dayIndex === 0) projectedNextDepletionMm = currentDepletionMillimeters;
    }

    return { entries: irrigationSchedule, projectedNextDepletionMm };
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

type PlaceIrrigationOutcome = {
    cycles: IrrigationCycle[];
    entry: IrrigationScheduleEntry;
};

/**
 * Computes the day's irrigation block, anchored so the last cycle ends at
 * sunrise and cycles fill backward into the night. Returns `null` when the
 * day is disallowed or no cycles fit the overnight window — callers treat
 * that as "skip, carry depletion forward."
 *
 * The overnight window is [midnight, sunrise] — no cycle may start before
 * 00:00 local of the irrigation entry's date.
 *
 * Past-window busy intervals (those starting at the epoch) are split out
 * from cross-zone busy windows and applied as a forward shift *after*
 * overnight-window validation, so a cycle whose planned time has already
 * passed gets pushed to fire now-ish rather than being dropped for ending
 * past sunrise.
 */
function tryPlaceIrrigationForDay(inputs: PlaceIrrigationInputs): PlaceIrrigationOutcome | null {
    const {
        date, sunrise, zone, currentDepletionMillimeters, totalAvailableWaterMillimeters,
        precipitationRateMillimetersPerHour, infiltrationRateMillimetersPerHour, soakTimeMinutes,
        busyWindowsSoFar, restrictions,
    } = inputs;

    if (!isDayAllowed(restrictions, date.isoWeekday())) {
        console.warn(`planner: zone ${zone.id} (${zone.name}): day ${date.format('YYYY-MM-DD')} (isoWeekday ${date.isoWeekday()}) disallowed by schedule restrictions — skipping irrigation.`);
        return null;
    }

    if (isNightSkipped(restrictions, date)) {
        console.warn(`planner: zone ${zone.id} (${zone.name}): day ${date.format('YYYY-MM-DD')} is skip-marked — skipping irrigation.`);
        return null;
    }

    const depletionBeforeIrrigation = currentDepletionMillimeters;
    const grossIrrigationDepthMillimeters = Math.min(
        currentDepletionMillimeters / zone.irrigationEfficiency,
        totalAvailableWaterMillimeters,
    );
    const totalRunTimeMinutes = (grossIrrigationDepthMillimeters / precipitationRateMillimetersPerHour) * 60;
    const maximumCycleMinutes = infiltrationRateMillimetersPerHour > 0
        ? (infiltrationRateMillimetersPerHour / precipitationRateMillimetersPerHour) * 60
        : totalRunTimeMinutes;

    // Overnight floor: midnight (00:00 local) of the irrigation entry's date.
    // No cycle may start before this time.
    const earliestStart = sunrise.startOf('day');

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

    const placedCycles = placeCyclesBackwardAvoidingBusy(
        totalRunTimeMinutes,
        maximumCycleMinutes,
        sunrise,
        soakTimeMinutes,
        earliestStart,
        crossZoneBusyWindows,
    );

    if (placedCycles === null) {
        console.warn(`planner: zone ${zone.id} (${zone.name}): overnight window too short to fit the planned cycles on ${date.format('YYYY-MM-DD')} — deferring irrigation.`);
        return null;
    }

    if (placedCycles.length === 0) {
        console.warn(`planner: zone ${zone.id} (${zone.name}): no cycles fit the overnight window on ${date.format('YYYY-MM-DD')} — skipping irrigation.`);
        return null;
    }

    // Past-window handling differs by schedule shape (API-66):
    //  - default: shift past-due cycles forward to fire at-or-after `now`.
    //    After shifting, drop any cycle whose startTime is before midnight of
    //    `date` (API-72) — a late-night re-plan can push cycles into the
    //    previous calendar day; those must be deferred, not fired.
    //  - `endBySunrise=true`: daytime irrigation is explicitly forbidden, so
    //    push-forward is wrong. Drop the past-due cycles instead and let
    //    depletion carry forward to the next allowed day.
    const finalCycles = (() => {
        if (pastWindow === undefined) return placedCycles;
        if (restrictions.endBySunrise === true) {
            const nowMs = pastWindow.end.valueOf();
            return placedCycles.filter(c => {
                const endMs = c.startTime.valueOf() + c.durationMin * 60_000;
                return endMs > nowMs;
            });
        }
        const shifted = deconflictCycles(placedCycles, [pastWindow], soakTimeMinutes);
        const midnight = date.startOf('day');
        return shifted.filter(c => !c.startTime.isBefore(midnight));
    })();

    if (finalCycles.length === 0) {
        console.warn(`planner: zone ${zone.id} (${zone.name}): no cycles remain after past-window handling on ${date.format('YYYY-MM-DD')} — skipping irrigation.`);
        return null;
    }

    const entry: IrrigationScheduleEntry = {
        date,
        zoneId: zone.id,
        cycles: finalCycles,
        appliedDepthMm: roundTo1Decimal(grossIrrigationDepthMillimeters),
        depletionBeforeMm: roundTo1Decimal(depletionBeforeIrrigation),
        depletionAfterMm: 0,
        sunriseAt: sunrise,
    };
    return { cycles: finalCycles, entry };
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
 * into the next allowed day.
 *
 * @param totalRunTimeMinutes - Total irrigation runtime needed.
 * @param maximumCycleMinutes - Maximum duration per cycle (infiltration limit).
 * @param sunrise - End anchor: last cycle ends here (or earlier if busy windows displace it).
 * @param soakTimeMinutes - Soak gap between consecutive cycles of this zone.
 * @param earliestStart - Hard floor: no cycle may start before this time (midnight of the entry date).
 * @param busyWindows - Intervals occupied by other zones (or the past window
 *   if handled here). Cycles slide earlier to avoid overlap.
 * @returns Cycles in chronological order (earliest first), `null` when the
 *   day must be deferred, or `[]` when nothing needs to run.
 */
function placeCyclesBackwardAvoidingBusy(
    totalRunTimeMinutes: number,
    maximumCycleMinutes: number,
    sunrise: dayjs.Dayjs,
    soakTimeMinutes: number,
    earliestStart: dayjs.Dayjs,
    busyWindows: ReadonlyArray<BusyWindow>,
): IrrigationCycle[] | null {
    if (totalRunTimeMinutes <= 0) return [];

    let numberOfCycles: number;
    let perCycleMinutes: number;
    if (maximumCycleMinutes <= 0 || totalRunTimeMinutes <= maximumCycleMinutes) {
        numberOfCycles = 1;
        perCycleMinutes = roundTo1Decimal(totalRunTimeMinutes);
    } else {
        numberOfCycles = Math.ceil(totalRunTimeMinutes / maximumCycleMinutes);
        perCycleMinutes = roundTo1Decimal(totalRunTimeMinutes / numberOfCycles);
    }

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

/**
 * Shifts cycles forward in chronological order so none overlap any busy
 * window, while preserving intra-zone soak time between consecutive cycles.
 * Walks input cycles in order; for each cycle the new start is at least
 * `max(plannedStart, prevPlacedEnd + soakTime)`, then iteratively pushed
 * past any busy interval it overlaps until stable. Durations are unchanged.
 *
 * @param cycles - Planned cycles (chronological, intra-zone soak-spaced).
 * @param busyWindows - Intervals to avoid. Order doesn't matter.
 * @param soakTimeMinutes - Soak time required between this zone's cycles.
 * @returns New cycle list with possibly-shifted start times.
 */
function deconflictCycles(
    cycles: IrrigationCycle[],
    busyWindows: ReadonlyArray<BusyWindow>,
    soakTimeMinutes: number,
): IrrigationCycle[] {
    if (cycles.length === 0) return cycles;
    if (busyWindows.length === 0) return cycles;

    const placed: IrrigationCycle[] = [];
    let prevEnd: dayjs.Dayjs | null = null;

    for (const cycle of cycles) {
        const intraZoneFloor: dayjs.Dayjs = prevEnd === null ? cycle.startTime : prevEnd.add(soakTimeMinutes, 'minute');
        let start: dayjs.Dayjs = cycle.startTime.isAfter(intraZoneFloor) ? cycle.startTime : intraZoneFloor;

        let shifted = true;
        while (shifted) {
            shifted = false;
            const cycleEnd = start.add(cycle.durationMin, 'minute');
            for (const window of busyWindows) {
                if (start.isBefore(window.end) && cycleEnd.isAfter(window.start)) {
                    start = window.end;
                    shifted = true;
                    break;
                }
            }
        }

        placed.push({ startTime: start, durationMin: cycle.durationMin });
        prevEnd = start.add(cycle.durationMin, 'minute');
    }

    return placed;
}

/**
 * Estimate soak time (minutes) based on infiltration rate.
 * Lower infiltration rates require longer soak times.
 *
 * @param infiltrationRateMmHr - Infiltration rate in mm/hr.
 * @returns Recommended soak time in minutes.
 */
function estimateSoakMinutes(infiltrationRateMmHr: number): number {
    if (infiltrationRateMmHr >= 20) return 15;
    if (infiltrationRateMmHr >= 12) return 25;
    if (infiltrationRateMmHr >= 8) return 35;
    if (infiltrationRateMmHr >= 5) return 45;
    return 60;
}

/**
 * Clamp a value between minimum and maximum bounds.
 *
 * @param value - The value to clamp.
 * @param min - Minimum allowed value.
 * @param max - Maximum allowed value.
 * @returns Clamped value.
 */
function clampValue(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

/**
 * Round a number to one decimal place.
 *
 * @param value - The number to round.
 * @returns Rounded value with one decimal place.
 */
function roundTo1Decimal(value: number): number {
    return Math.round(value * 10) / 10;
}