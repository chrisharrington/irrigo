import type { DailyWeather } from '@/models';

/**
 * Default forecast horizon (in days, starting tomorrow) the planner looks
 * ahead for rain before committing a night's irrigation. When the effective
 * rainfall forecast over this window would by itself bring depletion back
 * below the trigger, the night is skipped and depletion carries forward — the
 * standard smart-controller "rain delay". Conservative by design: the daemon
 * re-plans every evening, so a skip is reconsidered the next day if the rain
 * fails to materialise.
 *
 * Overridable per planning run via `planZoneSchedule`'s `rainSkipLookaheadDays`
 * argument, which the daemon sources from the `RAIN_SKIP_LOOKAHEAD_DAYS`
 * environment variable. A value of 0 disables the rain-skip entirely. Pairs
 * with the precipitation-source accuracy work tracked separately. API-85.
 */
export const DEFAULT_RAIN_SKIP_LOOKAHEAD_DAYS = 3;

/**
 * Converts gross daily rainfall into the depth that actually counts against
 * soil depletion: rain under 2 mm is treated as zero (intercepted / evaporated
 * before it infiltrates), and the rest is discounted to 80% to approximate
 * runoff and canopy interception. Used both for the day-by-day soil balance
 * and the forward-looking rain-skip lookahead so the credit math is identical.
 */
export function effectiveRainfall(rainfallMm: number): number {
    return rainfallMm < 2 ? 0 : 0.8 * rainfallMm;
}

/**
 * Sums the effective forecast rainfall over the `lookaheadDays` days that
 * follow `dayIndex` (the window starts at the *next* day — `dayIndex`'s own
 * rain is already folded into the running depletion before this is consulted).
 * The window is clamped to the end of `weatherHistory`, so a short forecast
 * tail simply contributes fewer days. Drives the planner's rain-skip decision.
 */
export function forecastEffectiveRainfall(
    weatherHistory: DailyWeather[],
    dayIndex: number,
    lookaheadDays: number,
): number {
    let total = 0;
    const lastIndex = Math.min(dayIndex + lookaheadDays, weatherHistory.length - 1);
    for (let i = dayIndex + 1; i <= lastIndex; i++) {
        total += effectiveRainfall(weatherHistory[i]!.rainfallMm ?? 0);
    }
    return total;
}
