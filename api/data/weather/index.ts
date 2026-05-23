import type { DailyWeather } from "@/models";
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
        rain_sum: string;
        et0_fao_evapotranspiration: string;
    };
    daily: {
        time: string[];
        sunrise: string[];
        sunset: string[];
        rain_sum: number[];
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
     * Optional. IANA timezone string (e.g. `America/Edmonton`). When provided,
     * Open-Meteo returns all daily times in that local timezone and the returned
     * DailyWeather dayjs objects are anchored to it. This is required for
     * `allowedTimeWindows` in schedule restrictions to align correctly with the
     * site's local clock.
     */
    timezone?: string;
};

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
 * @param params - Weather data request parameters
 * @returns Promise resolving to array of daily weather data
 * @throws Error if the API request fails after all retries
 */
export async function getWeatherData(params: WeatherDataParams): Promise<DailyWeather[]> {
    if (process.env.OPEN_METEO_ENABLED === 'false') {
        throw new Error('Weather integration is disabled (OPEN_METEO_ENABLED=false).');
    }

    const { latitude, longitude, forecastDays = 7, timezone } = params;

    const apiKey = process.env.OPEN_METEO_API_KEY || undefined;
    const baseUrl = apiKey
        ? 'https://customer-api.open-meteo.com/v1/forecast'
        : 'https://api.open-meteo.com/v1/forecast';

    const url = new URL(baseUrl);
    url.searchParams.set('latitude', latitude.toString());
    url.searchParams.set('longitude', longitude.toString());
    url.searchParams.set('daily', 'sunrise,sunset,rain_sum,et0_fao_evapotranspiration');
    url.searchParams.set('forecast_days', forecastDays.toString());
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

    try {
        const data = await response.json() as OpenMeteoResponse;

        return data.daily.time.map((time, index) => ({
            date: parseTime(time),
            sunrise: parseTime(data.daily.sunrise[index]!),
            sunset: parseTime(data.daily.sunset[index]!),
            rainfallMm: data.daily.rain_sum[index],
            evapotranspirationMmPerDay: data.daily.et0_fao_evapotranspiration[index],
        }));
    } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        console.error(`weather: Open-Meteo response could not be parsed: ${detail}`);
        throw new Error(`Open-Meteo response parse error: ${detail}`);
    }
}
