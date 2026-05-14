import dayjs from 'dayjs';
import type { Zone, DailyWeather, IrrigationScheduleEntry, IrrigationCycle } from '../../models';
import {
    isDayAllowed,
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
                prevDaySunset: dayIndex > 0 ? weatherHistory[dayIndex - 1]?.sunset : undefined,
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
    /** Sunset of the preceding calendar day. When set, the first cycle must start at or after this time. */
    prevDaySunset?: dayjs.Dayjs;
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
 * The overnight window is [prevDaySunset + 1 hour, sunrise]. Cycles that
 * would start before that window are dropped. If a cross-zone busy window
 * displaces every cycle past sunrise they are all dropped and the day skips.
 */
function tryPlaceIrrigationForDay(inputs: PlaceIrrigationInputs): PlaceIrrigationOutcome | null {
    const {
        date, sunrise, prevDaySunset, zone, currentDepletionMillimeters, totalAvailableWaterMillimeters,
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

    // Overnight window: sunset + 1 hour → sunrise. Fall back to midnight when
    // no previous-day sunset is available (dayIndex 0 or missing data).
    const earliestStart = prevDaySunset
        ? prevDaySunset.add(1, 'hour')
        : sunrise.startOf('day');

    const plannedCycles = buildCyclePlan(
        totalRunTimeMinutes,
        maximumCycleMinutes,
        sunrise,
        soakTimeMinutes,
        earliestStart,
    );

    if (plannedCycles.length === 0) {
        console.warn(`planner: zone ${zone.id} (${zone.name}): no cycles fit the overnight window on ${date.format('YYYY-MM-DD')} — skipping irrigation.`);
        return null;
    }

    const placedCycles = deconflictCycles(plannedCycles, busyWindowsSoFar, soakTimeMinutes);

    // Drop any cycle displaced past sunrise or before the sunset boundary by
    // cross-zone busy windows. 1-second tolerance absorbs floating-point drift
    // from non-integer cycle durations.
    const toleranceMs = 1000;
    const validCycles = placedCycles.filter(c => {
        const endMs = c.startTime.valueOf() + c.durationMin * 60_000;
        return !c.startTime.isBefore(earliestStart)
            && endMs <= sunrise.valueOf() + toleranceMs;
    });

    if (validCycles.length === 0) {
        console.warn(`planner: zone ${zone.id} (${zone.name}): all cycles displaced past sunrise by busy windows on ${date.format('YYYY-MM-DD')} — skipping irrigation.`);
        return null;
    }

    const entry: IrrigationScheduleEntry = {
        date,
        zoneId: zone.id,
        cycles: validCycles,
        appliedDepthMm: roundTo1Decimal(grossIrrigationDepthMillimeters),
        depletionBeforeMm: roundTo1Decimal(depletionBeforeIrrigation),
        depletionAfterMm: 0,
    };
    return { cycles: validCycles, entry };
}


/**
 * Builds an irrigation cycle plan anchored so the last cycle ends at sunrise,
 * filling backward into the night. Cycles that would start before
 * `earliestStart` (sunset + 1 hour) are omitted — the planner delivers as
 * many cycles as the overnight window can hold rather than all-or-nothing.
 *
 * @param totalRunTimeMinutes - Total irrigation runtime needed.
 * @param maximumCycleMinutes - Maximum duration per cycle (infiltration limit).
 * @param sunrise - End anchor: last cycle ends here.
 * @param soakTimeMinutes - Soak gap between consecutive cycles.
 * @param earliestStart - Hard floor: no cycle may start before this time.
 * @returns Cycles in chronological order (earliest first); may be fewer than
 *   the number needed to deliver the full gross depth if the window is short.
 */
function buildCyclePlan(
    totalRunTimeMinutes: number,
    maximumCycleMinutes: number,
    sunrise: dayjs.Dayjs,
    soakTimeMinutes: number,
    earliestStart: dayjs.Dayjs,
): IrrigationCycle[] {
    if (totalRunTimeMinutes <= 0) return [];

    if (maximumCycleMinutes <= 0 || totalRunTimeMinutes <= maximumCycleMinutes) {
        const durationMin = roundTo1Decimal(totalRunTimeMinutes);
        const startTime = sunrise.subtract(durationMin, 'minute');
        if (startTime.isBefore(earliestStart)) return [];
        return [{ startTime, durationMin }];
    }

    const numberOfCycles = Math.ceil(totalRunTimeMinutes / maximumCycleMinutes),
        perCycleMinutes = roundTo1Decimal(totalRunTimeMinutes / numberOfCycles);

    const cyclesInReverse: IrrigationCycle[] = [];
    let totalMinutesBeforeSunrise = 0;

    for (let i = 0; i < numberOfCycles; i++) {
        const offsetMinutes = totalMinutesBeforeSunrise + perCycleMinutes;
        const cycleStart = sunrise.subtract(offsetMinutes, 'minute');

        if (cycleStart.isBefore(earliestStart)) break; // window exhausted

        cyclesInReverse.push({ startTime: cycleStart, durationMin: perCycleMinutes });
        totalMinutesBeforeSunrise = offsetMinutes + soakTimeMinutes;
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