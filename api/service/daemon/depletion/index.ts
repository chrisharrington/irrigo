import type { ZoneActuationInterval } from '@/data/home-assistant';

/**
 * Sum of rain and reference ET over a window, as produced by
 * `sumHourlyWeatherBetween` (api/data/weather). Both fields are millimetres
 * accumulated across the window's hours.
 */
export type WeatherDelta = {
    rainMm: number;
    etMm: number;
};

/**
 * Inputs to `reconcileFromActuationHistory` — the morning tick's math.
 * Captures the soil state before reconciliation, the weather observed since
 * that state was written, the relay's actual on→off intervals during the
 * same window, and the zone calibration needed to convert run-time into
 * applied depth.
 */
export type ReconcileInput = {
    previousDepletionMm: number;
    weatherDelta: WeatherDelta;
    history: ReadonlyArray<ZoneActuationInterval>;
    /**
     * Zone's measured precipitation rate in mm/hour. The reconciler skips the
     * actuation term when this is undefined — the math degrades gracefully to
     * an evening-tick-style weather-only advance.
     */
    precipitationRateMmPerHr: number | undefined;
};

/**
 * Inputs to `advanceFromObservedWeather` — the evening tick's math. Same
 * shape minus the actuation history and precipitation rate, since the evening
 * tick assumes no irrigation has fired since the morning reconciler ran.
 */
export type AdvanceInput = {
    previousDepletionMm: number;
    weatherDelta: WeatherDelta;
};

/**
 * Result of a reconciliation. `appliedDepthMm` is the gross depth credited to
 * irrigation over the window — surfaced separately for logging and future
 * observability (e.g. comparing planned vs. actual applied depth per night).
 */
export type ReconcileResult = {
    newDepletionMm: number;
    appliedDepthMm: number;
};

/**
 * Morning-tick math: advance depletion from its last reconciled value through
 * the weather observed since (ET adds, rain subtracts) and the actuation
 * actually applied (subtracts). Result is clamped to non-negative — soil
 * cannot be "more than full."
 *
 * When `precipitationRateMmPerHr` is undefined (zone has no calibrated
 * precipitation rate), the actuation term is zero — depletion advances by
 * weather alone, equivalent to `advanceFromObservedWeather`.
 */
export function reconcileFromActuationHistory(input: ReconcileInput): ReconcileResult {
    const { previousDepletionMm, weatherDelta, history, precipitationRateMmPerHr } = input;

    let totalOnHours = 0;
    for (const interval of history) {
        const durationMs = interval.offAt.getTime() - interval.onAt.getTime();
        if (durationMs > 0) totalOnHours += durationMs / 3_600_000;
    }

    const appliedDepthMm = precipitationRateMmPerHr === undefined
        ? 0
        : totalOnHours * precipitationRateMmPerHr;

    const newDepletionMm = Math.max(
        0,
        previousDepletionMm + weatherDelta.etMm - weatherDelta.rainMm - appliedDepthMm,
    );

    return { newDepletionMm, appliedDepthMm };
}

/**
 * Evening-tick math: advance depletion through observed weather only. No
 * actuation term — the evening tick runs *before* tonight's cycles fire, so
 * the only soil-moisture changes since the morning reconciler are weather.
 * Result is clamped to non-negative.
 */
export function advanceFromObservedWeather(input: AdvanceInput): number {
    const { previousDepletionMm, weatherDelta } = input;
    return Math.max(0, previousDepletionMm + weatherDelta.etMm - weatherDelta.rainMm);
}
