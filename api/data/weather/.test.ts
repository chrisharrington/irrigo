import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { getWeatherData } from '.';

// Mock the global fetch function.
const mockFetch = mock(() => Promise.resolve({} as Response));
(global as any).fetch = mockFetch;

describe('Weather Data', () => {
    const mockWeatherResponse = {
        latitude: 52.52,
        longitude: 13.419998,
        generationtime_ms: 0.4398822784423828,
        utc_offset_seconds: 0,
        timezone: 'GMT',
        timezone_abbreviation: 'GMT',
        elevation: 38.0,
        daily_units: {
            time: 'iso8601',
            sunrise: 'iso8601',
            rain_sum: 'mm',
            et0_fao_evapotranspiration: 'mm',
        },
        daily: {
            time: ['2025-10-20', '2025-10-21', '2025-10-22'],
            sunrise: ['2025-10-20T05:41', '2025-10-21T05:43', '2025-10-22T05:45'],
            rain_sum: [0.2, 0.5, 0.0],
            et0_fao_evapotranspiration: [1.63, 1.62, 1.04],
        },
    };

    beforeEach(() => {
        mockFetch.mockClear();
    });

    it('should fetch weather data with correct URL parameters', async () => {
        // Mock successful API response.
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => mockWeatherResponse,
        } as Response);

        await getWeatherData({
            latitude: 52.52,
            longitude: 13.41,
            forecastDays: 7,
        });

        // Verify fetch was called once.
        expect(mockFetch).toHaveBeenCalledTimes(1);

        // Verify URL construction.
        const calledUrl = new URL((mockFetch.mock.calls[0] as any[])[0] as string);
        expect(calledUrl.hostname).toBe('api.open-meteo.com');
        expect(calledUrl.pathname).toBe('/v1/forecast');
        expect(calledUrl.searchParams.get('latitude')).toBe('52.52');
        expect(calledUrl.searchParams.get('longitude')).toBe('13.41');
        expect(calledUrl.searchParams.get('forecast_days')).toBe('7');
        expect(calledUrl.searchParams.get('daily')).toBe('sunrise,rain_sum,et0_fao_evapotranspiration');
    });

    it('should use default forecast days of 7 when not specified', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => mockWeatherResponse,
        } as Response);

        await getWeatherData({
            latitude: 52.52,
            longitude: 13.41,
        });

        const calledUrl = new URL((mockFetch.mock.calls[0] as any[])[0] as string);
        expect(calledUrl.searchParams.get('forecast_days')).toBe('7');
    });

    it('should transform API response into DailyWeather array', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => mockWeatherResponse,
        } as Response);

        const result = await getWeatherData({
            latitude: 52.52,
            longitude: 13.41,
        });

        // Verify array length.
        expect(result.length).toBe(3);

        // Verify first day's data.
        expect(result[0]!.date.format('YYYY-MM-DD')).toBe('2025-10-20');
        expect(result[0]!.sunrise?.format('YYYY-MM-DDTHH:mm')).toBe('2025-10-20T05:41');
        expect(result[0]!.rainfallMm).toBe(0.2);
        expect(result[0]!.evapotranspirationMmPerDay).toBe(1.63);

        // Verify second day's data.
        expect(result[1]!.date.format('YYYY-MM-DD')).toBe('2025-10-21');
        expect(result[1]!.sunrise?.format('YYYY-MM-DDTHH:mm')).toBe('2025-10-21T05:43');
        expect(result[1]!.rainfallMm).toBe(0.5);
        expect(result[1]!.evapotranspirationMmPerDay).toBe(1.62);

        // Verify third day's data.
        expect(result[2]!.date.format('YYYY-MM-DD')).toBe('2025-10-22');
        expect(result[2]!.sunrise?.format('YYYY-MM-DDTHH:mm')).toBe('2025-10-22T05:45');
        expect(result[2]!.rainfallMm).toBe(0.0);
        expect(result[2]!.evapotranspirationMmPerDay).toBe(1.04);
    });

    it('should throw error when API request fails', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: false,
            status: 500,
            statusText: 'Internal Server Error',
        } as Response);

        await expect(
            getWeatherData({
                latitude: 52.52,
                longitude: 13.41,
            })
        ).rejects.toThrow('Open-Meteo API request failed: 500 Internal Server Error');
    });

    it('should throw error on network failure', async () => {
        mockFetch.mockRejectedValueOnce(new Error('Network error'));

        await expect(
            getWeatherData({
                latitude: 52.52,
                longitude: 13.41,
            })
        ).rejects.toThrow('Network error');
    });

    it('should handle empty response arrays', async () => {
        const emptyResponse = {
            ...mockWeatherResponse,
            daily: {
                time: [],
                sunrise: [],
                rain_sum: [],
                et0_fao_evapotranspiration: [],
            },
        };

        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => emptyResponse,
        } as Response);

        const result = await getWeatherData({
            latitude: 52.52,
            longitude: 13.41,
        });

        expect(result.length).toBe(0);
    });

    it('should throw error when API response is malformed', async () => {
        const malformedResponse = {
            latitude: 52.52,
            longitude: 13.419998,
            // Missing daily object entirely
        };

        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => malformedResponse,
        } as Response);

        expect(
            getWeatherData({
                latitude: 52.52,
                longitude: 13.41,
            })
        ).rejects.toThrow();
    });

    it('should throw error when daily arrays are missing in response', async () => {
        const malformedResponse = {
            ...mockWeatherResponse,
            daily: {
                // Missing time array
                sunrise: ['2025-10-20T05:41'],
                rain_sum: [0.2],
                et0_fao_evapotranspiration: [1.63],
            },
        };

        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => malformedResponse,
        } as Response);

        await expect(
            getWeatherData({
                latitude: 52.52,
                longitude: 13.41,
            })
        ).rejects.toThrow();
    });

    it('should throw error when API returns non-JSON response', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => {
                throw new Error('Unexpected token < in JSON at position 0');
            },
        } as any);

        await expect(
            getWeatherData({
                latitude: 52.52,
                longitude: 13.41,
            })
        ).rejects.toThrow('Unexpected token < in JSON at position 0');
    });
});
