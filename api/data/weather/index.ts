import type { DailyWeather } from "@/models";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import tzPlugin from "dayjs/plugin/timezone";

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
 * Tuning for `fetchWithRetry`. Production callers use the defaults; tests
 * inject `sleep: async () => {}` to skip real timers, and may override
 * `attempts` / `backoffsMs` to exercise specific boundary cases.
 */
export type FetchWithRetryOptions = {
    /** Maximum total attempts including the first try. Default 3 (1 initial + 2 retries). */
    attempts?: number;
    /** Delay in ms before each retry. Length must equal `attempts - 1`. Default `[500, 1500]`. */
    backoffsMs?: readonly number[];
    /** Injectable sleep for tests. Default uses real `setTimeout`. */
    sleep?: (ms: number) => Promise<void>;
};

const DEFAULT_ATTEMPTS = 3;
const DEFAULT_BACKOFFS_MS = [500, 1500] as const;

function defaultSleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Internal helper. Fetches a URL, retrying on 5xx responses and network-layer
 * rejections (e.g. DNS / TCP errors thrown by `fetch`). On a 4xx response,
 * throws immediately — those signal a bad request, invalid API key, or
 * rate-limit hit and won't improve with another attempt. On success, returns
 * the 2xx `Response` for the caller to parse.
 *
 * Exported for tests; production code reaches it through `getWeatherData`.
 *
 * @internal
 */
export async function fetchWithRetry(url: string, opts: FetchWithRetryOptions = {}): Promise<Response> {
    const attempts = opts.attempts ?? DEFAULT_ATTEMPTS;
    const backoffsMs = opts.backoffsMs ?? DEFAULT_BACKOFFS_MS;
    const sleep = opts.sleep ?? defaultSleep;

    if (backoffsMs.length !== attempts - 1) {
        throw new Error(`fetchWithRetry: backoffsMs must have ${attempts - 1} entries for ${attempts} attempts; got ${backoffsMs.length}.`);
    }

    let lastNetworkError: Error | undefined;

    for (let attempt = 1; attempt <= attempts; attempt++) {
        let response: Response | undefined;
        try {
            response = await fetch(url);
        } catch (err) {
            const detail = err instanceof Error ? err.message : String(err);
            lastNetworkError = err instanceof Error ? err : new Error(detail);
            if (attempt < attempts) {
                console.warn(`weather: attempt ${attempt}/${attempts} failed (network: ${detail}); retrying in ${backoffsMs[attempt - 1]}ms.`);
                await sleep(backoffsMs[attempt - 1]!);
                continue;
            }
            const message = `Open-Meteo network error: ${detail}`;
            console.error(`weather: ${message}`);
            throw new Error(message);
        }

        if (response.ok) return response;

        // 4xx → bad request / auth / rate-limit. Don't retry.
        if (response.status >= 400 && response.status < 500) {
            const message = `Open-Meteo API request failed: ${response.status} ${response.statusText}`;
            console.error(`weather: ${message}`);
            throw new Error(message);
        }

        // 5xx → retry if attempts remain.
        if (attempt < attempts) {
            console.warn(`weather: attempt ${attempt}/${attempts} failed (${response.status} ${response.statusText}); retrying in ${backoffsMs[attempt - 1]}ms.`);
            await sleep(backoffsMs[attempt - 1]!);
            continue;
        }
        const message = `Open-Meteo API request failed: ${response.status} ${response.statusText}`;
        console.error(`weather: ${message}`);
        throw new Error(message);
    }

    // Unreachable — the loop always returns or throws. Kept to satisfy the
    // return-type contract.
    throw lastNetworkError ?? new Error('Open-Meteo: unknown error after retries.');
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
