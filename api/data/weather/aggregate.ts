import type { HourlyWeather } from '@/models';

/**
 * Pure helper. Returns the sum of `precipitationMm` and `evapotranspirationMm`
 * across hourly observations whose `time` falls in the half-open window
 * `[since, until)`. Open-Meteo emits one hourly row per hour-start, so each
 * row contributes fully if its hour-start is inside the window; partial hours
 * at the edges are *not* pro-rated (the reconciler's window boundaries are
 * always at tick times, ~12 hours apart, so the per-hour rounding error is
 * negligible compared to the 24+ rows summed).
 *
 * Used by the morning/evening reconcilers in api/service/daemon to compute
 * the depletion delta over the gap since the last reconciliation.
 */
export function sumHourlyWeatherBetween(
    hourly: ReadonlyArray<HourlyWeather>,
    since: Date,
    until: Date,
): { rainMm: number; etMm: number } {
    const sinceMs = since.getTime();
    const untilMs = until.getTime();
    let rainMm = 0;
    let etMm = 0;
    for (const row of hourly) {
        const t = row.time.valueOf();
        if (t < sinceMs || t >= untilMs) continue;
        rainMm += row.precipitationMm;
        etMm += row.evapotranspirationMm;
    }
    return { rainMm, etMm };
}
