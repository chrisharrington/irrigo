import pRetry, { AbortError, type Options as PRetryOptions } from 'p-retry';

export type OpenMeteoResponse = {
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
 * Builds the Open-Meteo forecast URL from the request params (selecting the
 * customer vs free-tier host based on `OPEN_METEO_API_KEY`) and fetches it via
 * `fetchWithRetry`. Returns the 2xx `Response` for the caller to parse.
 *
 * @param params - Weather data request parameters.
 * @returns The successful Open-Meteo `Response`.
 * @throws Error if the request fails after all retries.
 */
export async function fetchWeatherResponse(params: WeatherDataParams): Promise<Response> {
    const { latitude, longitude, forecastDays = 7, pastDays = 1, timezone } = params;

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

    return fetchWithRetry(url.toString());
}
