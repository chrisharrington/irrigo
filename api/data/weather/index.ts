import type { DailyWeather, HourlyWeather, WeatherData } from "@/models";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import tzPlugin from "dayjs/plugin/timezone";
import pRetry, { AbortError, type Options as PRetryOptions } from 'p-retry';

dayjs.extend(utc);
dayjs.extend(tzPlugin);

type OpenMeteoResponse = {
    latitude: number;
    longitude: number;
    generationtime_ms: number;
    utc_offset_seconds: number;
    timezone: string;
    timezone_abbreviation: string;
    elevation: number;
    daily_units: {
        time: string;
        sunrise: string;
        sunset: string;
        precipitation_sum: string;
        et0_fao_evapotranspiration: string;
    };
    daily: {
        time: string[];
        sunrise: string[];
        sunset: string[];
        precipitation_sum: number[];
        et0_fao_evapotranspiration: number[];
    };
    hourly: {
        time: string[];
        precipitation: number[];
        et0_fao_evapotranspiration: number[];
    };
};

export type WeatherDataParams = {
    /** Required. Latitude coordinate. */
    latitude: number;

    /** Required. Longitude coordinate. */
    longitude: number;

    /** Optional. Number of days to forecast (default: 7). */
    forecastDays?: number;

    /**
     * Optional. Number of days of past observations to include (default: 1).
     * The morning/evening reconcilers need yesterday's hourly observations to
     * sum ET and precipitation between the last reconciliation and now.
     */
    pastDays?: number;

    /**
     * Optional. IANA timezone string (e.g. `America/Edmonton`). When provided,
     * Open-Meteo returns all daily times in that local timezone and the returned
     * DailyWeather dayjs objects are anchored to it. This is required for
     * `allowedTimeWindows` in schedule restrictions to align correctly with the
     * site's local clock.
     */
    timezone?: string;
};

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
 * `p-retry` timing defaults tuned for Open-Meteo's free-tier reliability
 * profile. 2 retries → 3 total attempts. `factor: 3` + `minTimeout: 500`
 * produces the 500 ms → 1500 ms backoff. Tests override `minTimeout` /
 * `maxTimeout` to skip the real waits.
 */
const RETRY_TIMING_DEFAULTS: PRetryOptions = {
    retries: 2,
    factor: 3,
    minTimeout: 500,
    maxTimeout: 1500,
    randomize: false,
};

function logFailedAttempt({ error, attemptNumber, retriesLeft }: { error: Error; attemptNumber: number; retriesLeft: number }): void {
    if (retriesLeft > 0) {
        console.warn(`weather: attempt ${attemptNumber} failed (${error.message}); ${retriesLeft} retries left.`);
    }
}

/**
 * Internal helper. Fetches a URL via `p-retry`, retrying on 5xx responses
 * and network-layer rejections. 4xx responses throw immediately via
 * `AbortError` — those signal bad request / auth / rate-limit and won't
 * improve with another attempt. On success, returns the 2xx `Response` for
 * the caller to parse. Final failures log at `console.error` and rethrow
 * with the same message shape the alerter expects.
 *
 * Exported for tests; production code reaches it through `getWeatherData`.
 * Tests may pass `retryOptions` to override the timing defaults — the
 * `onFailedAttempt` logger is always installed by this helper, since the
 * daemon runs unattended and silent retries would defeat the point.
 *
 * @internal
 */
export async function fetchWithRetry(url: string, retryOptions: PRetryOptions = RETRY_TIMING_DEFAULTS): Promise<Response> {
    try {
        return await pRetry(async () => {
            let response: Response;
            try {
                response = await fetch(url);
            } catch (err) {
                const detail = err instanceof Error ? err.message : String(err);
                throw new Error(`Open-Meteo network error: ${detail}`);
            }

            if (response.ok) return response;

            const message = `Open-Meteo API request failed: ${response.status} ${response.statusText}`;
            // 4xx → bad request / auth / rate-limit; abort the retry loop.
            if (response.status >= 400 && response.status < 500) {
                throw new AbortError(message);
            }
            // 5xx → let p-retry retry (or surface the final throw).
            throw new Error(message);
        }, { ...retryOptions, onFailedAttempt: logFailedAttempt });
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`weather: ${message}`);
        throw err instanceof Error ? err : new Error(message);
    }
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

    const apiKey = process.env.OPEN_METEO_API_KEY || undefined;
    const baseUrl = apiKey
        ? 'https://customer-api.open-meteo.com/v1/forecast'
        : 'https://api.open-meteo.com/v1/forecast';

    const url = new URL(baseUrl);
    url.searchParams.set('latitude', latitude.toString());
    url.searchParams.set('longitude', longitude.toString());
    url.searchParams.set('daily', 'sunrise,sunset,precipitation_sum,et0_fao_evapotranspiration');
    url.searchParams.set('hourly', 'precipitation,et0_fao_evapotranspiration');
    url.searchParams.set('forecast_days', forecastDays.toString());
    url.searchParams.set('past_days', pastDays.toString());
    if (timezone) {
        url.searchParams.set('timezone', timezone);
    }
    if (apiKey) {
        url.searchParams.set('apikey', apiKey);
    }

    const response = await fetchWithRetry(url.toString());

    // Parse a time string in the correct timezone so that downstream dayjs
    // operations (startOf('day'), isoWeekday, hour comparisons) all use the
    // site's local clock rather than the container's UTC clock.
    const parseTime = (t: string): dayjs.Dayjs =>
        timezone ? dayjs.tz(t, timezone) : dayjs(t);

    let parsed: WeatherData;
    try {
        const data = await response.json() as OpenMeteoResponse;

        const daily: DailyWeather[] = data.daily.time.map((time, index) => ({
            date: parseTime(time),
            sunrise: parseTime(data.daily.sunrise[index]!),
            sunset: parseTime(data.daily.sunset[index]!),
            rainfallMm: data.daily.precipitation_sum[index],
            evapotranspirationMmPerDay: data.daily.et0_fao_evapotranspiration[index],
        }));

        const hourly: HourlyWeather[] = data.hourly.time.map((time, index) => ({
            time: parseTime(time),
            precipitationMm: data.hourly.precipitation[index] ?? 0,
            evapotranspirationMm: data.hourly.et0_fao_evapotranspiration[index] ?? 0,
        }));

        parsed = { daily, hourly };
    } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        console.error(`weather: Open-Meteo response could not be parsed: ${detail}`);
        throw new Error(`Open-Meteo response parse error: ${detail}`);
    }

    // Store only on successful parse — failed fetches and parse errors throw
    // above without polluting the cache.
    cache.set(cacheKey, { value: parsed, expiresAt: now() + ttlMs });
    return parsed;
}

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
