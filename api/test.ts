import dayjs from 'dayjs';
import { getWeatherData } from './data/weather';
import type { Zone } from './models';
import { planZoneSchedule } from './poc';

(async () => {
    // const weatherData = await getWeatherData({
    //     latitude: 51.05011,
    //     longitude: -114.08529,
    //     forecastDays: 14,
    // });

    // console.log(JSON.stringify(weatherData));

    const zone: Zone = {
        id: 'zone-001',
        name: 'Front Lawn',
        grassType: {
            name: 'Kentucky Bluegrass',
            cropCoefficient: 0.85,
        },
        soil: {
            name: 'Loam',
            availableWaterHoldingCapacityMmPerM: 150,
            infiltrationRateMmPerHr: 25,
        },
        rootDepthM: 0.3,
        allowableDepletionFraction: 0.5,
        irrigationEfficiency: 0.8,
        flowRateLPerMin: 15,
        areaM2: 100,
        precipitationRateMmPerHr: 12.5,
        currentDepletionMm: 15,
        isEnabled: true,
        location: {
            lat: 51.05011,
            lon: -114.08529,
        },
    };

    const weatherData = [
        {
            date: '2025-10-20T00:00:00.000Z',
            sunrise: '2025-10-20T14:09:00.000Z',
            rainfallMm: 0,
            evapotranspirationMmPerDay: 1.59,
        },
        {
            date: '2025-10-21T00:00:00.000Z',
            sunrise: '2025-10-21T14:10:00.000Z',
            rainfallMm: 0,
            evapotranspirationMmPerDay: 2.03,
        },
        {
            date: '2025-10-22T00:00:00.000Z',
            sunrise: '2025-10-22T14:12:00.000Z',
            rainfallMm: 0,
            evapotranspirationMmPerDay: 1.63,
        },
        {
            date: '2025-10-23T00:00:00.000Z',
            sunrise: '2025-10-23T14:14:00.000Z',
            rainfallMm: 0,
            evapotranspirationMmPerDay: 1.77,
        },
        {
            date: '2025-10-24T00:00:00.000Z',
            sunrise: '2025-10-24T14:16:00.000Z',
            rainfallMm: 0,
            evapotranspirationMmPerDay: 2.33,
        },
        {
            date: '2025-10-25T00:00:00.000Z',
            sunrise: '2025-10-25T14:17:00.000Z',
            rainfallMm: 0,
            evapotranspirationMmPerDay: 2.74,
        },
        {
            date: '2025-10-26T00:00:00.000Z',
            sunrise: '2025-10-26T14:19:00.000Z',
            rainfallMm: 0,
            evapotranspirationMmPerDay: 1.41,
        },
        {
            date: '2025-10-27T00:00:00.000Z',
            sunrise: '2025-10-27T14:21:00.000Z',
            rainfallMm: 0,
            evapotranspirationMmPerDay: 1.56,
        },
        {
            date: '2025-10-28T00:00:00.000Z',
            sunrise: '2025-10-28T14:23:00.000Z',
            rainfallMm: 0,
            evapotranspirationMmPerDay: 1.64,
        },
        {
            date: '2025-10-29T00:00:00.000Z',
            sunrise: '2025-10-29T14:24:00.000Z',
            rainfallMm: 0,
            evapotranspirationMmPerDay: 1.36,
        },
        {
            date: '2025-10-30T00:00:00.000Z',
            sunrise: '2025-10-30T14:26:00.000Z',
            rainfallMm: 0,
            evapotranspirationMmPerDay: 1.66,
        },
        {
            date: '2025-10-31T00:00:00.000Z',
            sunrise: '2025-10-31T14:28:00.000Z',
            rainfallMm: 0,
            evapotranspirationMmPerDay: 1.26,
        },
        {
            date: '2025-11-01T00:00:00.000Z',
            sunrise: '2025-11-01T14:29:00.000Z',
            rainfallMm: 0,
            evapotranspirationMmPerDay: 1.16,
        },
        {
            date: '2025-11-02T00:00:00.000Z',
            sunrise: '2025-11-02T14:31:00.000Z',
            rainfallMm: 0,
            evapotranspirationMmPerDay: 0.96,
        },
    ];

    const schedule = planZoneSchedule(zone, weatherData.map(dailyWeather => ({
        ...dailyWeather,
        date: dayjs(dailyWeather.date),
        sunrise: dayjs(dailyWeather.sunrise),
    })));

    console.log(JSON.stringify(schedule, null, 4));
})();
