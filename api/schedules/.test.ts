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

const stubSuccess = () => mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => stubWeatherResponse,
} as Response);

describe('runScheduleForZone', () => {
    beforeEach(() => {
        mockFetch.mockClear();
    });

    it(`passes the zone's location coordinates and default 7-day forecast to the weather API`, async () => {
        stubSuccess();
        const zone = createTestZone({ location: { lat: 51.0447, lon: -114.0719 } });

        await runScheduleForZone(zone);

        expect(mockFetch).toHaveBeenCalledTimes(1);
        const calledUrl = new URL((mockFetch.mock.calls[0] as unknown[])[0] as string);
        expect(calledUrl.searchParams.get('latitude')).toBe('51.0447');
        expect(calledUrl.searchParams.get('longitude')).toBe('-114.0719');
        expect(calledUrl.searchParams.get('forecast_days')).toBe('7');
    });

    it('passes a custom forecastDays option through to the weather API', async () => {
        stubSuccess();
        const zone = createTestZone({ location: { lat: 51.0447, lon: -114.0719 } });

        await runScheduleForZone(zone, { forecastDays: 14 });

        const calledUrl = new URL((mockFetch.mock.calls[0] as unknown[])[0] as string);
        expect(calledUrl.searchParams.get('forecast_days')).toBe('14');
    });

    it('returns a schedule produced from the fetched weather', async () => {
        stubSuccess();
        const zone = createTestZone({
            currentDepletionMm: 25,
            allowableDepletionFraction: 0.5,
            location: { lat: 51.0447, lon: -114.0719 },
        });

        const { entries: schedule } = await runScheduleForZone(zone);

        expect(schedule.length).toBeGreaterThan(0);
        expect(schedule[0]!.zoneId).toBe(zone.id);
        expect(schedule[0]!.appliedDepthMm).toBeGreaterThan(0);
    });

    it('returns the projected next-day depletion alongside the schedule entries', async () => {
        stubSuccess();
        const zone = createTestZone({
            currentDepletionMm: 5,
            allowableDepletionFraction: 0.5,
            location: { lat: 51.0447, lon: -114.0719 },
        });

        const result = await runScheduleForZone(zone);

        expect(result.projectedNextDepletionMm).toBeGreaterThan(0);
        expect(typeof result.projectedNextDepletionMm).toBe('number');
    });

    it('throws when the zone has no location and does not call the weather API', async () => {
        const zone = createTestZone({ location: undefined });

        await expect(runScheduleForZone(zone)).rejects.toThrow(/no location/);
        expect(mockFetch).not.toHaveBeenCalled();
    });

    it('propagates errors from the weather API to the caller', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: false,
            status: 503,
            statusText: 'Service Unavailable',
        } as Response);

        const zone = createTestZone({ location: { lat: 51.0447, lon: -114.0719 } });

        await expect(runScheduleForZone(zone)).rejects.toThrow(/503/);
    });

    it('forwards busyWindows to the planner so cycles avoid them', async () => {
        stubSuccess();
        const zone = createTestZone({
            currentDepletionMm: 22,
            soil: { name: 'TestSoil', availableWaterHoldingCapacityMmPerM: 150, infiltrationRateMmPerHr: 100 },
            precipitationRateMmPerHr: 50,
            location: { lat: 51.0447, lon: -114.0719 },
        });

        // First, baseline plan without busy windows — capture the cycle's natural start.
        stubSuccess();
        const baseline = await runScheduleForZone(zone);
        const baselineCycle = baseline.entries[0]!.cycles[0]!;

        // Now plan again with a busy window covering the baseline cycle's start.
        const busyStart = baselineCycle.startTime.subtract(15, 'minute').toDate();
        const busyEnd = baselineCycle.startTime.add(20, 'minute').toDate();

        const { entries } = await runScheduleForZone(zone, { busyWindows: [{ start: busyStart, end: busyEnd }] });

        const shifted = entries[0]!.cycles[0]!;
        expect(shifted.startTime.toDate().getTime()).toBe(busyEnd.getTime());
    });

    it('forwards schedule restrictions to the planner so disallowed days drop their cycles', async () => {
        stubSuccess();
        const zone = createTestZone({
            currentDepletionMm: 22,
            soil: { name: 'TestSoil', availableWaterHoldingCapacityMmPerM: 150, infiltrationRateMmPerHr: 100 },
            precipitationRateMmPerHr: 50,
            location: { lat: 51.0447, lon: -114.0719 },
        });

        // The weather stub has dates 2025-10-20 / 21 / 22 (Mon / Tue / Wed).
        // Allow only Wednesday (isoWeekday 3) — Mon and Tue should produce no entries.
        const result = await runScheduleForZone(zone, {
            restrictions: { allowedDays: [3], allowedTimeWindows: null },
        });

        for (const entry of result.entries) {
            expect(entry.date.isoWeekday()).toBe(3);
        }
        expect(result.entries.some(e => e.date.format('YYYY-MM-DD') === '2025-10-22')).toBe(true);
        expect(result.entries.some(e => e.date.format('YYYY-MM-DD') === '2025-10-20')).toBe(false);
    });

    it('returns an empty schedule when the weather API returns no days', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                ...stubWeatherResponse,
                daily: {
                    time: [],
                    sunrise: [],
                    rain_sum: [],
                    et0_fao_evapotranspiration: [],
                },
            }),
        } as Response);

        const zone = createTestZone({
            currentDepletionMm: 25,
            allowableDepletionFraction: 0.5,
            location: { lat: 51.0447, lon: -114.0719 },
        });

        const { entries: schedule } = await runScheduleForZone(zone);

        expect(schedule).toHaveLength(0);
    });
});
