import dayjs from 'dayjs';
import type { Zone, DailyWeather, IrrigationScheduleEntry, IrrigationCycle } from '../../models';
import {
    computeAllowedIntervalsForDay,
    computeForbiddenIntervalsForDay,
    isDayAllowed,
    pickAnchorForCycles,
    type AllowedInterval,
    type ScheduleRestrictions,
} from './restrictions';

const NO_RESTRICTIONS: ScheduleRestrictions = { allowedDays: null, allowedTimeWindows: null };

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
 * @returns Per-day entries plus the projected next-day starting depletion.
 */
export function planZoneSchedule(
    zone: Zone,
    weatherHistory: DailyWeather[],
    busyWindows: ReadonlyArray<BusyWindow> = [],
    restrictions: ScheduleRestrictions = NO_RESTRICTIONS,
): PlanZoneScheduleResult {
    const totalAvailableWaterMillimetersForClamp = zone.soil.availableWaterHoldingCapacityMmPerM * zone.rootDepthM,
        clampedStartingDepletion = clampValue(zone.currentDepletionMm ?? 0, 0, totalAvailableWaterMillimetersForClamp);

    if (zone.isEnabled === false) return { entries: [], projectedNextDepletionMm: clampedStartingDepletion };

    // Calculate soil water holding capacity and thresholds.
    const availableWaterHoldingCapacity = zone.soil.availableWaterHoldingCapacityMmPerM,
        totalAvailableWaterMillimeters = availableWaterHoldingCapacity * zone.rootDepthM,
        readilyAvailableWaterMillimeters = zone.allowableDepletionFraction * totalAvailableWaterMillimeters;

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
            cropEvapotranspiration = cropCoefficient * referenceEvapotranspiration,
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
 * Computes the day's irrigation block and places it within the day's
 * allowed time windows (if any). Returns `null` when the day is fully
 * disallowed or no allowed window can hold the requested runtime —
 * callers should treat that as "skip, carry depletion forward."
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

    const depletionBeforeIrrigation = currentDepletionMillimeters;
    const grossIrrigationDepthMillimeters = Math.min(
        currentDepletionMillimeters / zone.irrigationEfficiency,
        totalAvailableWaterMillimeters,
    );
    const totalRunTimeMinutes = (grossIrrigationDepthMillimeters / precipitationRateMillimetersPerHour) * 60;
    const maximumCycleMinutes = infiltrationRateMillimetersPerHour > 0
        ? (infiltrationRateMillimetersPerHour / precipitationRateMillimetersPerHour) * 60
        : totalRunTimeMinutes;

    const numberOfCycles = totalRunTimeMinutes <= maximumCycleMinutes || maximumCycleMinutes <= 0
        ? 1
        : Math.ceil(totalRunTimeMinutes / maximumCycleMinutes);
    const requiredSpanMinutes = totalRunTimeMinutes + (numberOfCycles - 1) * soakTimeMinutes;

    const allowedIntervals = computeAllowedIntervalsForDay(date, restrictions);
    const hasTimeWindows = restrictions.allowedTimeWindows !== null && restrictions.allowedTimeWindows.length > 0;
    const forbiddenForDay = hasTimeWindows ? computeForbiddenIntervalsForDay(date, restrictions) : [];

    // Pick an anchor:
    //  - No time-window restriction: the existing sunrise anchor.
    //  - Time-window restriction: latest allowed interval that fits, preferring
    //    one whose end is ≤ sunrise (preserves pre-dawn placement when feasible).
    const anchor = hasTimeWindows
        ? pickAnchorForCycles(allowedIntervals, sunrise, requiredSpanMinutes)
        : sunrise;
    if (anchor === null) {
        console.warn(`planner: zone ${zone.id} (${zone.name}): requested runtime ${requiredSpanMinutes.toFixed(1)} min cannot fit any allowed window on ${date.format('YYYY-MM-DD')} — skipping irrigation.`);
        return null;
    }

    const plannedCycles = buildCyclePlan(
        totalRunTimeMinutes,
        maximumCycleMinutes,
        anchor,
        soakTimeMinutes,
    );

    const combinedBusy = forbiddenForDay.length === 0
        ? busyWindowsSoFar
        : [...busyWindowsSoFar, ...forbiddenForDay];
    const placedCycles = deconflictCycles(plannedCycles, combinedBusy, soakTimeMinutes);

    // After deconflict, verify each cycle still lies wholly within an allowed
    // interval. A cycle pushed into a forbidden gap or beyond today's last
    // allowed interval means the placement failed.
    if (hasTimeWindows && !cyclesFitAllowed(placedCycles, allowedIntervals)) {
        console.warn(`planner: zone ${zone.id} (${zone.name}): cycles could not be placed within allowed windows on ${date.format('YYYY-MM-DD')} (cross-zone or window-gap conflict) — skipping irrigation.`);
        return null;
    }

    const entry: IrrigationScheduleEntry = {
        date,
        zoneId: zone.id,
        cycles: placedCycles,
        appliedDepthMm: roundTo1Decimal(grossIrrigationDepthMillimeters),
        depletionBeforeMm: roundTo1Decimal(depletionBeforeIrrigation),
        depletionAfterMm: 0,
    };
    return { cycles: placedCycles, entry };
}

function cyclesFitAllowed(cycles: ReadonlyArray<IrrigationCycle>, allowedIntervals: ReadonlyArray<AllowedInterval>): boolean {
    // 1-second tolerance absorbs floating-point creep from non-integer
    // durations (e.g. 34.4-minute cycles where the ms arithmetic doesn't
    // round-trip exactly through Dayjs).
    const toleranceMs = 1000;
    for (const cycle of cycles) {
        const startMs = cycle.startTime.valueOf();
        const endMs = startMs + cycle.durationMin * 60_000;
        const inside = allowedIntervals.some(interval =>
            startMs + toleranceMs >= interval.start.valueOf()
                && endMs <= interval.end.valueOf() + toleranceMs);
        if (!inside) return false;
    }
    return true;
}

/**
 * Build irrigation cycle plan that ends before sunrise.
 * Splits total runtime into multiple cycles if needed based on infiltration constraints.
 *
 * @param totalRunTimeMinutes - Total irrigation runtime needed.
 * @param maximumCycleMinutes - Maximum duration per cycle based on infiltration rate.
 * @param sunrise - Sunrise time as Dayjs object.
 * @param soakTimeMinutes - Soak time between cycles.
 * @returns Array of irrigation cycles in chronological order.
 */
function buildCyclePlan(
    totalRunTimeMinutes: number,
    maximumCycleMinutes: number,
    sunrise: dayjs.Dayjs,
    soakTimeMinutes: number
): IrrigationCycle[] {
    if (totalRunTimeMinutes <= 0) return [];

    // Use single cycle if total time fits within infiltration constraint.
    if (maximumCycleMinutes <= 0 || totalRunTimeMinutes <= maximumCycleMinutes) {
        const durationMin = roundTo1Decimal(totalRunTimeMinutes);
        const startTime = sunrise.subtract(durationMin, 'minute');
        return [{ startTime, durationMin }];
    }

    // Split into multiple cycles with soak time between.
    const numberOfCycles = Math.ceil(totalRunTimeMinutes / maximumCycleMinutes),
        perCycleMinutesRaw = totalRunTimeMinutes / numberOfCycles,
        perCycleMinutes = roundTo1Decimal(perCycleMinutesRaw);

    const cyclesInReverse: IrrigationCycle[] = [];
    let totalMinutesBeforeSunrise = 0;

    for (let i = 0; i < numberOfCycles; i++) {
        const cycleStartOffsetMinutes = totalMinutesBeforeSunrise + perCycleMinutes,
            cycleStart = sunrise.subtract(cycleStartOffsetMinutes, 'minute');

        cyclesInReverse.push({
            startTime: cycleStart,
            durationMin: perCycleMinutes,
        });

        // Add soak time before next earlier cycle.
        totalMinutesBeforeSunrise = cycleStartOffsetMinutes + soakTimeMinutes;
    }

    // Reverse to chronological order (earliest first).
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