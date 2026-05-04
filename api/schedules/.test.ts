import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { runScheduleForZone } from '.';
import { createTestZone } from '../mock/zone';

const mockFetch = mock(() => Promise.resolve({} as Response));
(global as unknown as { fetch: typeof mockFetch }).fetch = mockFetch;

const stubWeatherResponse = {
    latitude: 51.0447,
    longitude: -114.0719,
    generationtime_ms: 0.4,
    utc_offset_seconds: 0,
    timezone: 'GMT',
    timezone_abbreviation: 'GMT',
    elevation: 1045,
    daily_units: {
        time: 'iso8601',
        sunrise: 'iso8601',
        rain_sum: 'mm',
        et0_fao_evapotranspiration: 'mm',
    },
    daily: {
        time: ['2025-10-20', '2025-10-21', '2025-10-22'],
        sunrise: ['2025-10-20T07:30', '2025-10-21T07:31', '2025-10-22T07:33'],
        rain_sum: [0, 0, 0],
        et0_fao_evapotranspiration: [4.0, 4.0, 4.0],
    },
};

describe('runScheduleForZone', () => {
    beforeEach(() => {
        mockFetch.mockClear();
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => stubWeatherResponse,
        } as Response);
    });

    it(`passes the zone's location coordinates and default 7-day forecast to the weather API`, async () => {
        const zone = createTestZone({ location: { lat: 51.0447, lon: -114.0719 } });

        await runScheduleForZone(zone);

        expect(mockFetch).toHaveBeenCalledTimes(1);
        const calledUrl = new URL((mockFetch.mock.calls[0] as unknown[])[0] as string);
        expect(calledUrl.searchParams.get('latitude')).toBe('51.0447');
        expect(calledUrl.searchParams.get('longitude')).toBe('-114.0719');
        expect(calledUrl.searchParams.get('forecast_days')).toBe('7');
    });

    it('passes a custom forecastDays option through to the weather API', async () => {
        const zone = createTestZone({ location: { lat: 51.0447, lon: -114.0719 } });

        await runScheduleForZone(zone, { forecastDays: 14 });

        const calledUrl = new URL((mockFetch.mock.calls[0] as unknown[])[0] as string);
        expect(calledUrl.searchParams.get('forecast_days')).toBe('14');
    });

    it('returns a schedule produced from the fetched weather', async () => {
        const zone = createTestZone({
            currentDepletionMm: 25,
            allowableDepletionFraction: 0.5,
            location: { lat: 51.0447, lon: -114.0719 },
        });

        const schedule = await runScheduleForZone(zone);

        expect(schedule.length).toBeGreaterThan(0);
        expect(schedule[0]!.zoneId).toBe(zone.id);
        expect(schedule[0]!.appliedDepthMm).toBeGreaterThan(0);
    });

    it('throws when the zone has no location and does not call the weather API', async () => {
        mockFetch.mockClear();
        const zone = createTestZone({ location: undefined });

        await expect(runScheduleForZone(zone)).rejects.toThrow(/no location/);
        expect(mockFetch).not.toHaveBeenCalled();
    });
});
