import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { runScheduleForZone, resolveRainSkipLookaheadDays } from '.';
import { DEFAULT_RAIN_SKIP_LOOKAHEAD_DAYS } from './dynamic';
import { __resetWeatherCacheForTests } from '../data/weather';
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
        sunset: 'iso8601',
        rain_sum: 'mm',
        et0_fao_evapotranspiration: 'mm',
    },
    daily: {
        // Trailing 2025-10-23 supplies the next-day-sunrise anchor for
        // planning days 0-2 (API-76 drops the last day in the horizon).
        time: ['2025-10-20', '2025-10-21', '2025-10-22', '2025-10-23'],
        sunrise: ['2025-10-20T07:30', '2025-10-21T07:31', '2025-10-22T07:33', '2025-10-23T07:34'],
        sunset: ['2025-10-20T18:10', '2025-10-21T18:08', '2025-10-22T18:06', '2025-10-23T18:04'],
        rain_sum: [0, 0, 0, 0],
        et0_fao_evapotranspiration: [4.0, 4.0, 4.0, 4.0],
    },
    hourly: {
        time: ['2025-10-20T00:00', '2025-10-20T01:00'],
        precipitation: [0, 0],
        et0_fao_evapotranspiration: [0.1, 0.1],
    },
};

const stubSuccess = () => mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => stubWeatherResponse,
} as Response);

describe('runScheduleForZone', () => {
    beforeEach(() => {
        mockFetch.mockClear();
        __resetWeatherCacheForTests();
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
        expect(calledUrl.searchParams.get('timezone')).toBe('America/Edmonton');
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

    it('propagates errors from the weather API to the caller after retries exhaust', async () => {
        // Three 503s walk the helper through all retry attempts; the final
        // throw is what the planner must surface.
        mockFetch
            .mockResolvedValueOnce({ ok: false, status: 503, statusText: 'Service Unavailable' } as Response)
            .mockResolvedValueOnce({ ok: false, status: 503, statusText: 'Service Unavailable' } as Response)
            .mockResolvedValueOnce({ ok: false, status: 503, statusText: 'Service Unavailable' } as Response);

        const zone = createTestZone({ location: { lat: 51.0447, lon: -114.0719 } });

        await expect(runScheduleForZone(zone)).rejects.toThrow(/503/);
    });

    it('forwards busyWindows to the planner so cycles avoid them', async () => {
        // Single stub — the second `runScheduleForZone` call hits the API-70
        // weather cache (same lat/lon/forecastDays/timezone) and skips fetch.
        stubSuccess();
        const zone = createTestZone({
            currentDepletionMm: 22,
            soil: { name: 'TestSoil', availableWaterHoldingCapacityMmPerM: 150, infiltrationRateMmPerHr: 100 },
            precipitationRateMmPerHr: 50,
            location: { lat: 51.0447, lon: -114.0719 },
        });

        // Baseline plan without busy windows — captures the natural cycle placement.
        const baseline = await runScheduleForZone(zone);
        const baselineCycle = baseline.entries[0]!.cycles[0]!;
        const baselineDay = baseline.entries[0]!.date.format('YYYY-MM-DD');

        // Apply a busy window that straddles the cycle's natural start. Per API-66
        // the planner now slides the cycle earlier (ending at busyStart) instead of
        // shoving it forward past sunrise.
        const busyStart = baselineCycle.startTime.subtract(15, 'minute').toDate();
        const busyEnd = baselineCycle.startTime.add(20, 'minute').toDate();

        const { entries } = await runScheduleForZone(zone, { busyWindows: [{ start: busyStart, end: busyEnd }] });

        const dayEntry = entries.find(e => e.date.format('YYYY-MM-DD') === baselineDay);
        expect(dayEntry).toBeDefined();
        for (const cycle of dayEntry!.cycles) {
            const cycleEnd = cycle.startTime.add(cycle.durationMin, 'minute').toDate();
            // No cycle overlaps the busy window.
            const overlap = cycle.startTime.toDate() < busyEnd && cycleEnd > busyStart;
            expect(overlap).toBe(false);
        }
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

    it('forwards schedule overrides to the planner so cycle counts change without zone edits', async () => {
        const zone = createTestZone({
            currentDepletionMm: 5,
            allowableDepletionFraction: 0.5,
            rootDepthM: 0.3,
            soil: { name: 'Loam', availableWaterHoldingCapacityMmPerM: 150, infiltrationRateMmPerHr: 25 },
            location: { lat: 51.0447, lon: -114.0719 },
        });

        // Single stub — the second `runScheduleForZone` call hits the API-70
        // weather cache (same lat/lon/forecastDays/timezone) and skips the
        // fetch entirely.
        stubSuccess();

        // Baseline — Maintenance-style cadence against the stubbed 3-day forecast.
        const baseline = await runScheduleForZone(zone);

        // Overseeding-style overrides: RAW ≈ 1.875 mm, ET ≈ 3.4 mm/day → daily.
        const overseeding = await runScheduleForZone(zone, {
            overrides: { rootDepthM: 0.05, allowableDepletionFraction: 0.25 },
        });

        expect(overseeding.entries.length).toBeGreaterThan(baseline.entries.length);
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
                hourly: {
                    time: [],
                    precipitation: [],
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

describe('resolveRainSkipLookaheadDays', () => {
    it('falls back to the default when the env var is unset', () => {
        expect(resolveRainSkipLookaheadDays(undefined)).toBe(DEFAULT_RAIN_SKIP_LOOKAHEAD_DAYS);
    });

    it('parses a positive integer', () => {
        expect(resolveRainSkipLookaheadDays('5')).toBe(5);
    });

    it('accepts 0 to disable the rain-skip', () => {
        expect(resolveRainSkipLookaheadDays('0')).toBe(0);
    });

    it('falls back to the default on non-numeric input', () => {
        expect(resolveRainSkipLookaheadDays('soon')).toBe(DEFAULT_RAIN_SKIP_LOOKAHEAD_DAYS);
    });

    it('falls back to the default on a negative value', () => {
        expect(resolveRainSkipLookaheadDays('-2')).toBe(DEFAULT_RAIN_SKIP_LOOKAHEAD_DAYS);
    });
});
