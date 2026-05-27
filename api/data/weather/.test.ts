import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test';
import dayjs from 'dayjs';
import { __resetWeatherCacheForTests, fetchWithRetry, getWeatherData, sumHourlyWeatherBetween } from '.';
import type { HourlyWeather } from '@/models';

// Production defaults wait 500 ms then 1500 ms between attempts; tests
// short-circuit both via `minTimeout: 0` so the retry loop runs without
// piling two seconds of real waits onto every failure case.
const FAST_RETRY_OPTS = { retries: 2, factor: 3, minTimeout: 0, maxTimeout: 0, randomize: false };

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
        hourly: {
            time: ['2025-10-20T00:00', '2025-10-20T01:00', '2025-10-20T02:00'],
            precipitation: [0.0, 0.1, 0.2],
            et0_fao_evapotranspiration: [0.02, 0.03, 0.05],
        },
    };

    beforeEach(() => {
        mockFetch.mockClear();
        __resetWeatherCacheForTests();
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
        expect(calledUrl.searchParams.get('past_days')).toBe('1');
        expect(calledUrl.searchParams.get('daily')).toBe('sunrise,sunset,rain_sum,et0_fao_evapotranspiration');
        expect(calledUrl.searchParams.get('hourly')).toBe('precipitation,et0_fao_evapotranspiration');
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

    it('should transform API response into daily and hourly arrays', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => mockWeatherResponse,
        } as Response);

        const { daily, hourly } = await getWeatherData({
            latitude: 52.52,
            longitude: 13.41,
        });

        // Verify daily array length.
        expect(daily.length).toBe(3);

        // Verify first day's data.
        expect(daily[0]!.date.format('YYYY-MM-DD')).toBe('2025-10-20');
        expect(daily[0]!.sunrise?.format('YYYY-MM-DDTHH:mm')).toBe('2025-10-20T05:41');
        expect(daily[0]!.sunset?.format('YYYY-MM-DDTHH:mm')).toBe('2025-10-20T18:10');
        expect(daily[0]!.rainfallMm).toBe(0.2);
        expect(daily[0]!.evapotranspirationMmPerDay).toBe(1.63);

        // Verify second day's data.
        expect(daily[1]!.date.format('YYYY-MM-DD')).toBe('2025-10-21');
        expect(daily[1]!.sunrise?.format('YYYY-MM-DDTHH:mm')).toBe('2025-10-21T05:43');
        expect(daily[1]!.sunset?.format('YYYY-MM-DDTHH:mm')).toBe('2025-10-21T18:08');
        expect(daily[1]!.rainfallMm).toBe(0.5);
        expect(daily[1]!.evapotranspirationMmPerDay).toBe(1.62);

        // Verify third day's data.
        expect(daily[2]!.date.format('YYYY-MM-DD')).toBe('2025-10-22');
        expect(daily[2]!.sunrise?.format('YYYY-MM-DDTHH:mm')).toBe('2025-10-22T05:45');
        expect(daily[2]!.sunset?.format('YYYY-MM-DDTHH:mm')).toBe('2025-10-22T18:06');
        expect(daily[2]!.rainfallMm).toBe(0.0);
        expect(daily[2]!.evapotranspirationMmPerDay).toBe(1.04);

        // Verify hourly array.
        expect(hourly.length).toBe(3);
        expect(hourly[0]!.time.format('YYYY-MM-DDTHH:mm')).toBe('2025-10-20T00:00');
        expect(hourly[0]!.precipitationMm).toBe(0.0);
        expect(hourly[0]!.evapotranspirationMm).toBe(0.02);
        expect(hourly[2]!.precipitationMm).toBe(0.2);
        expect(hourly[2]!.evapotranspirationMm).toBe(0.05);
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

        const { daily } = await getWeatherData({
            latitude: 52.52,
            longitude: 13.41,
            timezone: 'America/Edmonton',
        });

        // '2025-10-20T05:41' interpreted as 5:41am America/Edmonton (MDT=UTC-6 in Oct).
        // In UTC that's 11:41am. utcOffset() for an America/Edmonton dayjs is -360 (MDT).
        expect(daily[0]!.sunrise).toBeDefined();
        // Verify the offset matches the specified timezone (MDT = -360 min in Oct 2025).
        expect(daily[0]!.sunrise!.utcOffset()).toBe(-360);
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
            hourly: {
                time: [],
                precipitation: [],
                et0_fao_evapotranspiration: [],
            },
        };

        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => emptyResponse,
        } as Response);

        const { daily, hourly } = await getWeatherData({
            latitude: 52.52,
            longitude: 13.41,
        });

        expect(daily.length).toBe(0);
        expect(hourly.length).toBe(0);
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

describe('Weather caching', () => {
    let errorSpy: ReturnType<typeof spyOn>;
    let logSpy: ReturnType<typeof spyOn>;

    const sampleResponse = {
        latitude: 51.0,
        longitude: -114.0,
        generationtime_ms: 0.5,
        utc_offset_seconds: 0,
        timezone: 'GMT',
        timezone_abbreviation: 'GMT',
        elevation: 1045,
        daily_units: {
            time: 'iso8601',
            sunrise: 'iso8601',
            sunset: 'iso8601',
            rain_sum: 'mm',
            et0_fao_evapotranspiration: 'mm',
        },
        daily: {
            time: ['2026-05-24', '2026-05-25'],
            sunrise: ['2026-05-24T05:41', '2026-05-25T05:40'],
            sunset: ['2026-05-24T21:24', '2026-05-25T21:25'],
            rain_sum: [0, 0],
            et0_fao_evapotranspiration: [4.0, 4.0],
        },
        hourly: {
            time: ['2026-05-24T00:00', '2026-05-24T01:00'],
            precipitation: [0, 0],
            et0_fao_evapotranspiration: [0.1, 0.1],
        },
    };

    const stubSuccess = () => mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => sampleResponse,
    } as Response);

    beforeEach(() => {
        mockFetch.mockClear();
        __resetWeatherCacheForTests();
        errorSpy = spyOn(console, 'error').mockImplementation(() => {});
        logSpy = spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
        errorSpy.mockRestore();
        logSpy.mockRestore();
    });

    it('returns the cached value on a second call within the TTL — no upstream fetch', async () => {
        stubSuccess();
        const fixedNow = () => 1_700_000_000_000;
        const params = { latitude: 51.0447, longitude: -114.0719, forecastDays: 7, timezone: 'America/Edmonton' };

        const first = await getWeatherData(params, { now: fixedNow });
        const second = await getWeatherData(params, { now: fixedNow });

        expect(mockFetch).toHaveBeenCalledTimes(1);
        expect(second).toBe(first); // reference-equal — same cached object
    });

    it('refetches after the TTL has expired', async () => {
        stubSuccess();
        stubSuccess();
        let virtualNow = 1_700_000_000_000;
        const now = () => virtualNow;
        const params = { latitude: 51.0447, longitude: -114.0719 };

        await getWeatherData(params, { now });
        // Advance past the default 10 min TTL (with 1 ms slack).
        virtualNow += 10 * 60_000 + 1;
        await getWeatherData(params, { now });

        expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('keys the cache by (latitude, longitude, forecastDays, pastDays, timezone) so each variant misses independently', async () => {
        stubSuccess();
        stubSuccess();
        stubSuccess();
        stubSuccess();
        stubSuccess();
        const fixedNow = () => 1_700_000_000_000;
        const base = { latitude: 51.0, longitude: -114.0, forecastDays: 7, pastDays: 1, timezone: 'America/Edmonton' };

        await getWeatherData(base, { now: fixedNow });
        await getWeatherData({ ...base, latitude: 51.1 }, { now: fixedNow });
        await getWeatherData({ ...base, forecastDays: 14 }, { now: fixedNow });
        await getWeatherData({ ...base, pastDays: 2 }, { now: fixedNow });
        await getWeatherData({ ...base, timezone: 'UTC' }, { now: fixedNow });

        expect(mockFetch).toHaveBeenCalledTimes(5);
    });

    it('does not populate the cache when the upstream call fails', async () => {
        // Three persistent 503s exhaust the retry loop on the first attempt.
        // Note: this test pays the ~2 s retry-backoff cost because
        // `getWeatherData` doesn't expose `fetchWithRetry`'s timing knobs.
        mockFetch
            .mockResolvedValueOnce({ ok: false, status: 503, statusText: 'Service Unavailable' } as Response)
            .mockResolvedValueOnce({ ok: false, status: 503, statusText: 'Service Unavailable' } as Response)
            .mockResolvedValueOnce({ ok: false, status: 503, statusText: 'Service Unavailable' } as Response);
        const params = { latitude: 51.0, longitude: -114.0 };
        await expect(getWeatherData(params, { now: () => 0 })).rejects.toThrow(/503/);

        // Subsequent successful call should fetch again — proving the prior
        // failure did not pollute the cache.
        stubSuccess();
        await getWeatherData(params, { now: () => 0 });

        // 3 failed + 1 successful = 4 fetch attempts total.
        expect(mockFetch).toHaveBeenCalledTimes(4);
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
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Open-Meteo API request failed: 502 Bad Gateway'));
    });

    it('retries a network rejection and succeeds on a later attempt', async () => {
        mockFetch
            .mockRejectedValueOnce(new TypeError('Network request failed'))
            .mockResolvedValueOnce({ ok: true, status: 200 } as Response);

        const response = await fetchWithRetry('https://example.test/', FAST_RETRY_OPTS);

        expect(response.ok).toBe(true);
        expect(mockFetch).toHaveBeenCalledTimes(2);
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Open-Meteo network error: Network request failed'));
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

    it('honours a custom retries cap', async () => {
        // 1 retry → 2 total attempts; 5xx twice should throw with no third try.
        mockFetch
            .mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Internal Server Error' } as Response)
            .mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Internal Server Error' } as Response);

        await expect(
            fetchWithRetry('https://example.test/', { ...FAST_RETRY_OPTS, retries: 1 }),
        ).rejects.toThrow('Open-Meteo API request failed: 500 Internal Server Error');
        expect(mockFetch).toHaveBeenCalledTimes(2);
    });
});

describe('sumHourlyWeatherBetween', () => {
    function mkRow(timeIso: string, precipitationMm: number, evapotranspirationMm: number): HourlyWeather {
        return { time: dayjs(timeIso), precipitationMm, evapotranspirationMm };
    }

    it('sums rows whose time falls inside [since, until)', async () => {
        const rows = [
            mkRow('2026-05-24T05:00:00Z', 0.1, 0.05),
            mkRow('2026-05-24T06:00:00Z', 0.2, 0.06),
            mkRow('2026-05-24T07:00:00Z', 0.3, 0.07),
        ];

        const result = sumHourlyWeatherBetween(
            rows,
            new Date('2026-05-24T05:00:00Z'),
            new Date('2026-05-24T07:00:00Z'),
        );

        // The 07:00 row is excluded because `until` is exclusive.
        expect(result.rainMm).toBeCloseTo(0.3, 6);
        expect(result.etMm).toBeCloseTo(0.11, 6);
    });

    it('returns zero when the window is empty (since >= until)', async () => {
        const rows = [
            mkRow('2026-05-24T05:00:00Z', 1, 1),
            mkRow('2026-05-24T06:00:00Z', 1, 1),
        ];

        const result = sumHourlyWeatherBetween(
            rows,
            new Date('2026-05-24T06:00:00Z'),
            new Date('2026-05-24T06:00:00Z'),
        );

        expect(result).toEqual({ rainMm: 0, etMm: 0 });
    });

    it('returns zero when no rows fall in the window', async () => {
        const rows = [
            mkRow('2026-05-24T05:00:00Z', 1, 1),
            mkRow('2026-05-24T06:00:00Z', 1, 1),
        ];

        const result = sumHourlyWeatherBetween(
            rows,
            new Date('2026-05-25T00:00:00Z'),
            new Date('2026-05-25T03:00:00Z'),
        );

        expect(result).toEqual({ rainMm: 0, etMm: 0 });
    });

    it('handles an empty hourly array', async () => {
        const result = sumHourlyWeatherBetween(
            [],
            new Date('2026-05-24T05:00:00Z'),
            new Date('2026-05-24T07:00:00Z'),
        );

        expect(result).toEqual({ rainMm: 0, etMm: 0 });
    });

    it('spans day boundaries correctly', async () => {
        const rows = [
            mkRow('2026-05-24T22:00:00Z', 0.5, 0.05),
            mkRow('2026-05-24T23:00:00Z', 0.6, 0.04),
            mkRow('2026-05-25T00:00:00Z', 0.7, 0.03),
            mkRow('2026-05-25T01:00:00Z', 0.8, 0.02),
        ];

        const result = sumHourlyWeatherBetween(
            rows,
            new Date('2026-05-24T23:00:00Z'),
            new Date('2026-05-25T01:00:00Z'),
        );

        // 23:00 + 00:00 included; 01:00 excluded.
        expect(result.rainMm).toBeCloseTo(1.3, 6);
        expect(result.etMm).toBeCloseTo(0.07, 6);
    });
});
