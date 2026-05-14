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
 * Retrieves daily weather data from Open-Meteo API including sunrise times,
 * rainfall totals, and reference evapotranspiration (ET0).
 *
 * @param params - Weather data request parameters
 * @returns Promise resolving to array of daily weather data
 * @throws Error if the API request fails
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

    let response: Response;
    try {
        response = await fetch(url.toString());
    } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        console.error(`weather: Open-Meteo network error: ${detail}`);
        throw new Error(`Open-Meteo network error: ${detail}`);
    }

    if (!response.ok) {
        const message = `Open-Meteo API request failed: ${response.status} ${response.statusText}`;
        console.error(`weather: ${message}`);
        throw new Error(message);
    }

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
