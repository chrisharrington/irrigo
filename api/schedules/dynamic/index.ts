import dayjs from 'dayjs';
import type { Zone, DailyWeather, IrrigationScheduleEntry, IrrigationCycle } from '../../models';

/**
 * Plan irrigation schedule for a zone based on weather history.
 * Uses soil moisture balance to determine when irrigation is needed.
 *
 * @param zone - The irrigation zone configuration.
 * @param weatherHistory - Array of daily weather data.
 * @returns Array of scheduled irrigation entries.
 */
export function planZoneSchedule(zone: Zone, weatherHistory: DailyWeather[]): IrrigationScheduleEntry[] {
    if (zone.isEnabled === false) return [];

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
    let currentDepletionMillimeters = clampValue(zone.currentDepletionMm ?? 0, 0, totalAvailableWaterMillimeters);

    const irrigationSchedule: IrrigationScheduleEntry[] = [];

    // Process each day of weather history.
    for (const weatherDay of weatherHistory) {
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
            const depletionBeforeIrrigation = currentDepletionMillimeters;

            // Calculate net irrigation depth needed to fully replenish soil.
            const netIrrigationDepthMillimeters = currentDepletionMillimeters;

            // Adjust for irrigation efficiency to get gross depth applied.
            const irrigationEfficiency = zone.irrigationEfficiency,
                grossIrrigationDepthMillimeters = Math.min(
                    netIrrigationDepthMillimeters / irrigationEfficiency,
                    totalAvailableWaterMillimeters
                );

            // Calculate total runtime without cycle splitting.
            const totalRunTimeMinutes = (grossIrrigationDepthMillimeters / precipitationRateMillimetersPerHour) * 60;

            // Determine maximum cycle duration based on infiltration rate.
            const maximumCycleMinutes =
                infiltrationRateMillimetersPerHour > 0
                    ? (infiltrationRateMillimetersPerHour / precipitationRateMillimetersPerHour) * 60
                    : totalRunTimeMinutes;

            // Build cycle plan ending before sunrise.
            const cycleList = buildCyclePlan(
                totalRunTimeMinutes,
                maximumCycleMinutes,
                sunrise,
                soakTimeMinutes
            );

            // Reset depletion to zero after irrigation (soil fully replenished).
            const depletionAfterIrrigation = 0;

            irrigationSchedule.push({
                date: date,
                zoneId: zone.id,
                cycles: cycleList,
                appliedDepthMm: roundTo1Decimal(grossIrrigationDepthMillimeters),
                depletionBeforeMm: roundTo1Decimal(depletionBeforeIrrigation),
                depletionAfterMm: roundTo1Decimal(depletionAfterIrrigation),
            });

            // Continue accumulating depletion for the rest of the day after irrigation.
            currentDepletionMillimeters = clampValue(
                depletionAfterIrrigation + cropEvapotranspiration - effectiveRainfallMillimeters,
                0,
                totalAvailableWaterMillimeters
            );
        }

        // Ensure depletion stays within valid bounds.
        currentDepletionMillimeters = clampValue(currentDepletionMillimeters, 0, totalAvailableWaterMillimeters);
    }

    return irrigationSchedule;
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
        const startTime = sunrise.subtract(totalRunTimeMinutes, 'minute');
        return [{ startTime, durationMin: roundTo1Decimal(totalRunTimeMinutes) }];
    }

    // Split into multiple cycles with soak time between.
    const numberOfCycles = Math.ceil(totalRunTimeMinutes / maximumCycleMinutes),
        perCycleMinutes = totalRunTimeMinutes / numberOfCycles;

    const cyclesInReverse: IrrigationCycle[] = [];
    let totalMinutesBeforeSunrise = 0;

    for (let i = 0; i < numberOfCycles; i++) {
        const cycleStartOffsetMinutes = totalMinutesBeforeSunrise + perCycleMinutes,
            cycleStart = sunrise.subtract(cycleStartOffsetMinutes, 'minute');

        cyclesInReverse.push({
            startTime: cycleStart,
            durationMin: roundTo1Decimal(perCycleMinutes),
        });

        // Add soak time before next earlier cycle.
        totalMinutesBeforeSunrise = cycleStartOffsetMinutes + soakTimeMinutes;
    }

    // Reverse to chronological order (earliest first).
    return cyclesInReverse.reverse();
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