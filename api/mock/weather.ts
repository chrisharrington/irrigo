import dayjs, { type Dayjs } from 'dayjs';
import type { DailyWeather } from '../models';

/**
 * Creates a single daily weather record with sensible defaults.
 *
 * @param overrides - Partial DailyWeather object to override defaults
 * @returns Complete DailyWeather object
 */
export function createWeatherDay(overrides?: Partial<DailyWeather>): DailyWeather {
    const date = overrides?.date ?? dayjs();
    return {
        date,
        sunrise: date.hour(6).minute(0).second(0),
        rainfallMm: 0,
        evapotranspirationMmPerDay: 2.0,
        ...overrides,
    };
}

/**
 * Creates an array of weather days from partial data.
 *
 * @param days - Array of partial DailyWeather objects
 * @param startDate - Starting date for the weather sequence
 * @returns Array of complete DailyWeather objects
 */
export function createWeatherDays(
    days: Partial<DailyWeather>[],
    startDate: Dayjs = dayjs('2025-10-20')
): DailyWeather[] {
    return days.map((day, index) =>
        createWeatherDay({
            date: startDate.add(index, 'day'),
            sunrise: startDate.add(index, 'day').hour(6).minute(0).second(0),
            ...day,
        })
    );
}

/**
 * Creates weather pattern with no rainfall and consistent ET.
 *
 * @param days - Number of days
 * @param etPerDay - Daily ET in mm
 * @param startDate - Starting date
 * @returns Array of DailyWeather objects
 */
export function createDryPeriod(days: number, etPerDay: number, startDate?: Dayjs): DailyWeather[] {
    return Array.from({ length: days }, (_, i) =>
        createWeatherDay({
            date: (startDate ?? dayjs()).add(i, 'day'),
            evapotranspirationMmPerDay: etPerDay,
            rainfallMm: 0,
        })
    );
}

/**
 * Creates weather pattern with heavy rainfall and low ET.
 *
 * @param days - Number of days
 * @param rainfallPerDay - Daily rainfall in mm
 * @param startDate - Starting date
 * @returns Array of DailyWeather objects
 */
export function createRainyPeriod(days: number, rainfallPerDay: number, startDate?: Dayjs): DailyWeather[] {
    return Array.from({ length: days }, (_, i) =>
        createWeatherDay({
            date: (startDate ?? dayjs()).add(i, 'day'),
            evapotranspirationMmPerDay: 1.0,
            rainfallMm: rainfallPerDay,
        })
    );
}

/**
 * Creates weather pattern with alternating dry and rainy days.
 *
 * @param days - Number of days
 * @param startDate - Starting date
 * @returns Array of DailyWeather objects
 */
export function createIntermittentRainfall(days: number, startDate?: Dayjs): DailyWeather[] {
    return Array.from({ length: days }, (_, i) =>
        createWeatherDay({
            date: (startDate ?? dayjs()).add(i, 'day'),
            evapotranspirationMmPerDay: 2.5,
            rainfallMm: i % 3 === 0 ? 5.0 : 0,
        })
    );
}

/**
 * Creates weather pattern with variable ET values.
 *
 * @param days - Number of days
 * @param startDate - Starting date
 * @returns Array of DailyWeather objects
 */
export function createVariableET(days: number, startDate?: Dayjs): DailyWeather[] {
    const etPattern = [1.5, 2.0, 3.5, 2.8, 1.8, 4.0, 2.2];
    return Array.from({ length: days }, (_, i) =>
        createWeatherDay({
            date: (startDate ?? dayjs()).add(i, 'day'),
            evapotranspirationMmPerDay: etPattern[i % etPattern.length],
            rainfallMm: 0,
        })
    );
}

/**
 * Creates weather pattern simulating a heat wave.
 *
 * @param days - Number of days
 * @param startDate - Starting date
 * @returns Array of DailyWeather objects
 */
export function createHeatWave(days: number, startDate?: Dayjs): DailyWeather[] {
    return Array.from({ length: days }, (_, i) =>
        createWeatherDay({
            date: (startDate ?? dayjs()).add(i, 'day'),
            evapotranspirationMmPerDay: 5.5 + Math.random() * 1.5,
            rainfallMm: 0,
        })
    );
}
