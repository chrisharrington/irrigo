import type { DailyWeather } from "@/models";
import dayjs from "dayjs";

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
        rain_sum: string;
        et0_fao_evapotranspiration: string;
    };
    daily: {
        time: string[];
        sunrise: string[];
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
    const { latitude, longitude, forecastDays = 7 } = params;

    // Construct the API URL with required parameters.
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.searchParams.set('latitude', latitude.toString());
    url.searchParams.set('longitude', longitude.toString());
    url.searchParams.set('daily', 'sunrise,rain_sum,et0_fao_evapotranspiration');
    url.searchParams.set('forecast_days', forecastDays.toString());

    // Make the API request.
    const response = await fetch(url.toString());

    if (!response.ok) {
        throw new Error(`Open-Meteo API request failed: ${response.status} ${response.statusText}`);
    }

    // Parse the JSON response.
    const data = await response.json() as OpenMeteoResponse;

    // Transform the parallel arrays into an array of objects.
    const dailyData: DailyWeather[] = data.daily.time.map((time, index) => ({
        date: dayjs(time),
        sunrise: dayjs(data.daily.sunrise[index]),
        rainfallMm: data.daily.rain_sum[index],
        evapotranspirationMmPerDay: data.daily.et0_fao_evapotranspiration[index],
    }));

    return dailyData;
}
