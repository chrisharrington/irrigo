import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test';
import { fetchWithRetry, getWeatherData } from '.';

// Production defaults are [500, 1500]; tests pass a no-op sleep so the
// retry loop runs synchronously and doesn't pile two seconds of waits onto
// every failure case.
const FAST_RETRY_OPTS = { sleep: async () => {} };

// Mock the global fetch function.
const mockFetch = mock(() => Promise.resolve({} as Response));
(global as any).fetch = mockFetch;

describe('Weather Data', () => {
    let errorSpy: ReturnType<typeof spyOn>;

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
            sunset: 'iso8601',
            rain_sum: 'mm',
            et0_fao_evapotranspiration: 'mm',
        },
        daily: {
            time: ['2025-10-20', '2025-10-21', '2025-10-22'],
            sunrise: ['2025-10-20T05:41', '2025-10-21T05:43', '2025-10-22T05:45'],
            sunset: ['2025-10-20T18:10', '2025-10-21T18:08', '2025-10-22T18:06'],
            rain_sum: [0.2, 0.5, 0.0],
            et0_fao_evapotranspiration: [1.63, 1.62, 1.04],
        },
    };

    beforeEach(() => {
        mockFetch.mockClear();
        errorSpy = spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        errorSpy.mockRestore();
        delete process.env.OPEN_METEO_ENABLED;
        delete process.env.OPEN_METEO_API_KEY;
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
        expect(calledUrl.searchParams.get('daily')).toBe('sunrise,sunset,rain_sum,et0_fao_evapotranspiration');
        expect(calledUrl.searchParams.get('timezone')).toBeNull();
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
        expect(result[0]!.sunset?.format('YYYY-MM-DDTHH:mm')).toBe('2025-10-20T18:10');
        expect(result[0]!.rainfallMm).toBe(0.2);
        expect(result[0]!.evapotranspirationMmPerDay).toBe(1.63);

        // Verify second day's data.
        expect(result[1]!.date.format('YYYY-MM-DD')).toBe('2025-10-21');
        expect(result[1]!.sunrise?.format('YYYY-MM-DDTHH:mm')).toBe('2025-10-21T05:43');
        expect(result[1]!.sunset?.format('YYYY-MM-DDTHH:mm')).toBe('2025-10-21T18:08');
        expect(result[1]!.rainfallMm).toBe(0.5);
        expect(result[1]!.evapotranspirationMmPerDay).toBe(1.62);

        // Verify third day's data.
        expect(result[2]!.date.format('YYYY-MM-DD')).toBe('2025-10-22');
        expect(result[2]!.sunrise?.format('YYYY-MM-DDTHH:mm')).toBe('2025-10-22T05:45');
        expect(result[2]!.sunset?.format('YYYY-MM-DDTHH:mm')).toBe('2025-10-22T18:06');
        expect(result[2]!.rainfallMm).toBe(0.0);
        expect(result[2]!.evapotranspirationMmPerDay).toBe(1.04);
    });

    it('should throw immediately on a 4xx response without retrying', async () => {
        // Routed through the public getWeatherData entrypoint so we cover the
        // integration; 4xx skips retries entirely, so the production-default
        // backoffs never sleep.
        mockFetch.mockResolvedValueOnce({
            ok: false,
            status: 404,
            statusText: 'Not Found',
        } as Response);

        await expect(
            getWeatherData({
                latitude: 52.52,
                longitude: 13.41,
            })
        ).rejects.toThrow('Open-Meteo API request failed: 404 Not Found');
        expect(mockFetch).toHaveBeenCalledTimes(1);
        expect(errorSpy).toHaveBeenCalledWith(
            'weather: Open-Meteo API request failed: 404 Not Found',
        );
    });

    it('should include timezone param in URL when specified', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => mockWeatherResponse,
        } as Response);

        await getWeatherData({
            latitude: 52.52,
            longitude: 13.41,
            timezone: 'America/Edmonton',
        });

        const calledUrl = new URL((mockFetch.mock.calls[0] as any[])[0] as string);
        expect(calledUrl.searchParams.get('timezone')).toBe('America/Edmonton');
    });

    it('should parse times as timezone-aware dayjs objects when timezone is specified', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => mockWeatherResponse,
        } as Response);

        const result = await getWeatherData({
            latitude: 52.52,
            longitude: 13.41,
            timezone: 'America/Edmonton',
        });

        // '2025-10-20T05:41' interpreted as 5:41am America/Edmonton (MDT=UTC-6 in Oct).
        // In UTC that's 11:41am. utcOffset() for an America/Edmonton dayjs is -360 (MDT).
        expect(result[0]!.sunrise).toBeDefined();
        // Verify the offset matches the specified timezone (MDT = -360 min in Oct 2025).
        expect(result[0]!.sunrise!.utcOffset()).toBe(-360);
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

        await expect(
            getWeatherData({
                latitude: 52.52,
                longitude: 13.41,
            })
        ).rejects.toThrow(/^Open-Meteo response parse error: /);
        expect(errorSpy).toHaveBeenCalled();
        expect(errorSpy.mock.calls[0]![0]).toMatch(/^weather: Open-Meteo response could not be parsed: /);
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
        ).rejects.toThrow(/^Open-Meteo response parse error: /);
        expect(errorSpy).toHaveBeenCalled();
        expect(errorSpy.mock.calls[0]![0]).toMatch(/^weather: Open-Meteo response could not be parsed: /);
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
        ).rejects.toThrow('Open-Meteo response parse error: Unexpected token < in JSON at position 0');
        expect(errorSpy).toHaveBeenCalledWith(
            'weather: Open-Meteo response could not be parsed: Unexpected token < in JSON at position 0',
        );
    });

    it('throws when OPEN_METEO_ENABLED is false without calling fetch', async () => {
        process.env.OPEN_METEO_ENABLED = 'false';

        await expect(
            getWeatherData({ latitude: 52.52, longitude: 13.41 })
        ).rejects.toThrow('Weather integration is disabled (OPEN_METEO_ENABLED=false).');
        expect(mockFetch).not.toHaveBeenCalled();
        // Configuration short-circuit, not a failure — no error log expected.
        expect(errorSpy).not.toHaveBeenCalled();
    });

    it('uses commercial endpoint and appends apikey when OPEN_METEO_API_KEY is set', async () => {
        process.env.OPEN_METEO_API_KEY = 'test-key';
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => mockWeatherResponse,
        } as Response);

        await getWeatherData({ latitude: 52.52, longitude: 13.41 });

        const calledUrl = new URL((mockFetch.mock.calls[0] as any[])[0] as string);
        expect(calledUrl.hostname).toBe('customer-api.open-meteo.com');
        expect(calledUrl.searchParams.get('apikey')).toBe('test-key');
    });

    it('does not send apikey param on free-tier requests', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => mockWeatherResponse,
        } as Response);

        await getWeatherData({ latitude: 52.52, longitude: 13.41 });

        const calledUrl = new URL((mockFetch.mock.calls[0] as any[])[0] as string);
        expect(calledUrl.hostname).toBe('api.open-meteo.com');
        expect(calledUrl.searchParams.get('apikey')).toBeNull();
    });
});

describe('fetchWithRetry', () => {
    let warnSpy: ReturnType<typeof spyOn>;
    let errorSpy: ReturnType<typeof spyOn>;

    beforeEach(() => {
        mockFetch.mockClear();
        warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
        errorSpy = spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        warnSpy.mockRestore();
        errorSpy.mockRestore();
    });

    it('returns a 2xx response on the first attempt without retrying', async () => {
        mockFetch.mockResolvedValueOnce({ ok: true, status: 200 } as Response);

        const response = await fetchWithRetry('https://example.test/', FAST_RETRY_OPTS);

        expect(response.ok).toBe(true);
        expect(mockFetch).toHaveBeenCalledTimes(1);
        expect(warnSpy).not.toHaveBeenCalled();
    });

    it('retries a 5xx response and succeeds on a later attempt', async () => {
        mockFetch
            .mockResolvedValueOnce({ ok: false, status: 502, statusText: 'Bad Gateway' } as Response)
            .mockResolvedValueOnce({ ok: true, status: 200 } as Response);

        const response = await fetchWithRetry('https://example.test/', FAST_RETRY_OPTS);

        expect(response.ok).toBe(true);
        expect(mockFetch).toHaveBeenCalledTimes(2);
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('attempt 1/3 failed (502 Bad Gateway)'));
    });

    it('retries a network rejection and succeeds on a later attempt', async () => {
        mockFetch
            .mockRejectedValueOnce(new TypeError('Network request failed'))
            .mockResolvedValueOnce({ ok: true, status: 200 } as Response);

        const response = await fetchWithRetry('https://example.test/', FAST_RETRY_OPTS);

        expect(response.ok).toBe(true);
        expect(mockFetch).toHaveBeenCalledTimes(2);
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('attempt 1/3 failed (network: Network request failed)'));
    });

    it('throws after exhausting all attempts on persistent 5xx', async () => {
        mockFetch
            .mockResolvedValueOnce({ ok: false, status: 503, statusText: 'Service Unavailable' } as Response)
            .mockResolvedValueOnce({ ok: false, status: 503, statusText: 'Service Unavailable' } as Response)
            .mockResolvedValueOnce({ ok: false, status: 503, statusText: 'Service Unavailable' } as Response);

        await expect(
            fetchWithRetry('https://example.test/', FAST_RETRY_OPTS),
        ).rejects.toThrow('Open-Meteo API request failed: 503 Service Unavailable');
        expect(mockFetch).toHaveBeenCalledTimes(3);
        expect(errorSpy).toHaveBeenCalledWith('weather: Open-Meteo API request failed: 503 Service Unavailable');
    });

    it('throws after exhausting all attempts on persistent network errors', async () => {
        mockFetch
            .mockRejectedValueOnce(new Error('Network error'))
            .mockRejectedValueOnce(new Error('Network error'))
            .mockRejectedValueOnce(new Error('Network error'));

        await expect(
            fetchWithRetry('https://example.test/', FAST_RETRY_OPTS),
        ).rejects.toThrow('Open-Meteo network error: Network error');
        expect(mockFetch).toHaveBeenCalledTimes(3);
        expect(errorSpy).toHaveBeenCalledWith('weather: Open-Meteo network error: Network error');
    });

    it('throws immediately on a 4xx without retrying', async () => {
        mockFetch.mockResolvedValueOnce({ ok: false, status: 401, statusText: 'Unauthorized' } as Response);

        await expect(
            fetchWithRetry('https://example.test/', FAST_RETRY_OPTS),
        ).rejects.toThrow('Open-Meteo API request failed: 401 Unauthorized');
        expect(mockFetch).toHaveBeenCalledTimes(1);
        expect(warnSpy).not.toHaveBeenCalled();
    });

    it('respects the configurable attempt cap', async () => {
        // 2 attempts (1 retry); 5xx twice should throw with no third try.
        mockFetch
            .mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Internal Server Error' } as Response)
            .mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Internal Server Error' } as Response);

        await expect(
            fetchWithRetry('https://example.test/', { attempts: 2, backoffsMs: [0], sleep: async () => {} }),
        ).rejects.toThrow('Open-Meteo API request failed: 500 Internal Server Error');
        expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('rejects mis-sized backoff arrays at the boundary', async () => {
        await expect(
            fetchWithRetry('https://example.test/', { attempts: 3, backoffsMs: [100], sleep: async () => {} }),
        ).rejects.toThrow(/backoffsMs must have 2 entries for 3 attempts/);
        expect(mockFetch).not.toHaveBeenCalled();
    });
});
