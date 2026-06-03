import type { DailyWeather, HourlyWeather, WeatherData } from '@/models';
import dayjs from '@/util/dayjs';
import type { OpenMeteoResponse } from './fetch';

/**
 * Parses an Open-Meteo `Response` into the domain `WeatherData` model. Daily
 * and hourly times are anchored to `timezone` when provided so downstream
 * dayjs operations (`startOf('day')`, `isoWeekday`, hour comparisons) use the
 * site's local clock rather than the container's UTC clock. JSON-body and
 * normalization failures both surface as a single `Open-Meteo response parse
 * error` so the caller can treat the response as unusable.
 *
 * @param response - The successful Open-Meteo `Response` from the fetch layer.
 * @param timezone - Optional IANA timezone to anchor parsed times to.
 * @returns The normalized `WeatherData`.
 * @throws Error if the body can't be parsed or normalized.
 */
export async function parseWeatherResponse(response: Response, timezone?: string): Promise<WeatherData> {
    // Parse a time string in the correct timezone so that downstream dayjs
    // operations (startOf('day'), isoWeekday, hour comparisons) all use the
    // site's local clock rather than the container's UTC clock.
    const parseTime = (t: string): dayjs.Dayjs =>
        timezone ? dayjs.tz(t, timezone) : dayjs(t);

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

        return { daily, hourly };
    } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        console.error(`weather: Open-Meteo response could not be parsed: ${detail}`);
        throw new Error(`Open-Meteo response parse error: ${detail}`);
    }
}
