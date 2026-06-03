import type { WeatherData } from '@/models';
import { fetchWeatherResponse, type WeatherDataParams } from './fetch';
import { parseWeatherResponse } from './parse';

/**
 * Optional second-arg knobs on `getWeatherData`. Tuned for test-injection of
 * the cache clock and TTL; production callers pass nothing and inherit the
 * 10-minute default. See API-70.
 */
export type WeatherDataOptions = {
    /** Optional. Cache TTL override in ms. Defaults to `WEATHER_CACHE_TTL_MS`. */
    ttlMs?: number;

    /** Optional. Clock injection for testability. Defaults to `Date.now`. */
    now?: () => number;
};

/**
 * Process-local TTL cache for Open-Meteo responses. Open-Meteo's forecast can
 * shift between calls within minutes (model refreshes, rolling forecast
 * window, ET₀ adjustments); without caching, two back-to-back re-plans can
 * produce different schedules from the same site state. See API-70.
 *
 * Keyed by `${latitude}|${longitude}|${forecastDays}|${pastDays}|${timezone ?? ''}`
 * — the full set of request parameters that vary between callers. `apiKey` is
 * deliberately omitted; it's a process-wide constant, not a request input.
 */
type WeatherCacheEntry = { value: WeatherData; expiresAt: number };
const cache = new Map<string, WeatherCacheEntry>();

/** 10 minutes — long enough to dedupe rapid re-plan storms, short enough that a "stale" forecast can't drift far from reality (Open-Meteo's model refreshes hourly). */
const WEATHER_CACHE_TTL_MS = 10 * 60_000;

/**
 * Test seam. Clears every cached weather response so each `bun test` case
 * starts with an empty cache.
 *
 * @internal
 */
export function __resetWeatherCacheForTests(): void {
    cache.clear();
}

/**
 * Retrieves daily weather data from Open-Meteo API including sunrise times,
 * rainfall totals, and reference evapotranspiration (ET0). Transient 5xx
 * responses and network-layer errors are retried up to two times with
 * exponential backoff before the final failure surfaces to the caller.
 *
 * Successful responses are cached for `WEATHER_CACHE_TTL_MS` (10 min) keyed
 * by `(latitude, longitude, forecastDays, timezone)` so rapid re-plans see a
 * stable forecast and produce deterministic schedules.
 *
 * @param params - Weather data request parameters
 * @param options - Cache TTL / clock overrides for tests
 * @returns Promise resolving to array of daily weather data
 * @throws Error if the API request fails after all retries
 */
export async function getWeatherData(
    params: WeatherDataParams,
    options?: WeatherDataOptions,
): Promise<WeatherData> {
    if (process.env.OPEN_METEO_ENABLED === 'false') {
        throw new Error('Weather integration is disabled (OPEN_METEO_ENABLED=false).');
    }

    const { latitude, longitude, forecastDays = 7, pastDays = 1, timezone } = params;
    const ttlMs = options?.ttlMs ?? WEATHER_CACHE_TTL_MS;
    const now = options?.now ?? Date.now;

    const cacheKey = `${latitude}|${longitude}|${forecastDays}|${pastDays}|${timezone ?? ''}`;
    const cached = cache.get(cacheKey);
    if (cached !== undefined && cached.expiresAt > now()) {
        console.log(`weather: cache hit for ${cacheKey}.`);
        return cached.value;
    }

    const response = await fetchWeatherResponse({ latitude, longitude, forecastDays, pastDays, timezone });
    const parsed = await parseWeatherResponse(response, timezone);

    // Store only on successful parse — failed fetches and parse errors throw
    // above without polluting the cache.
    cache.set(cacheKey, { value: parsed, expiresAt: now() + ttlMs });
    return parsed;
}

export { fetchWithRetry, type WeatherDataParams } from './fetch';
export { sumHourlyWeatherBetween } from './aggregate';
