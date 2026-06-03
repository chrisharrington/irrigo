import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import dayjs from 'dayjs';
import type { Alerter, AlertEvent } from '@/alerts';
import { createTestZone } from '@/mock/zone';
import type { WeatherData, Zone } from '@/models';
import type { ScheduleEntriesRepository } from '@/repositories/schedule-entries';
import type { ZonesRepository } from '@/repositories/zones';
import { bootSystemService } from '@/service/system';
import { runBootSequence, type BootDeps } from '.';
import type { Clock, TimerHandle } from '../runtime';
import { TimerRegistry } from '../runtime';

const NOW = new Date('2026-05-04T12:00:00.000Z');

function fakeClock(at: Date = NOW): Clock {
    return {
        now: () => at,
        setTimeout: () => 1 as TimerHandle,
        clearTimeout: () => {},
    };
}

function recordingAlerter(): { alerter: Alerter; calls: AlertEvent[] } {
    const calls: AlertEvent[] = [];
    return { alerter: async (event) => { calls.push(event); }, calls };
}

function buildZonesRepo(zones: Zone[] = [], total = zones.length, enabled = zones.length): ZonesRepository {
    return {
        loadEnabled: async () => zones,
        findById: async () => null,
        count: async () => ({ total, enabled }),
        loadJoinedRowsForSummary: async () => [],
        loadLatestFires: async () => [],
        advanceDepletion: async () => {},
    };
}

function buildScheduleEntriesRepo(future: Awaited<ReturnType<ScheduleEntriesRepository['loadFutureCycles']>> = []): ScheduleEntriesRepository {
    return {
        loadFutureCycles: async () => future,
        loadInFlightCycles: async () => [],
        replaceForZone: async () => ({ cycles: [] }),
        markCycleFired: async () => {},
        markCycleClosed: async () => {},
        findScheduledFromDate: async () => [],
    };
}

function buildDeps(overrides: Partial<BootDeps> = {}): BootDeps {
    return {
        clock: fakeClock(),
        registry: new TimerRegistry(),
        alerter: recordingAlerter().alerter,
        openZone: async () => {},
        closeZone: async () => {},
        getZoneState: async () => 'off',
        getWeather: async (): Promise<WeatherData> => ({ daily: [], hourly: [] }),
        zonesRepo: buildZonesRepo(),
        scheduleEntriesRepo: buildScheduleEntriesRepo(),
        ...overrides,
    };
}

describe('runBootSequence', () => {
    let warnSpy: ReturnType<typeof spyOn>;

    beforeEach(() => {
        bootSystemService({
            repo: {
                findSingleton: async () => ({ irrigationEnabled: true, since: NOW }),
                upsertSingleton: async () => {},
            },
        });
        warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        warnSpy.mockRestore();
    });

    it('seeds initialSunrise from the first enabled zone\'s weather fetch', async () => {
        const sunrise = dayjs('2026-05-05T11:41:00Z');
        const result = await runBootSequence({
            morningTickMinutesAfterSunrise: 60,
            deps: buildDeps({
                zonesRepo: buildZonesRepo([createTestZone({ id: 'zone-001', location: { lat: 51, lon: -114 } })]),
                getWeather: async () => ({ daily: [{ date: sunrise, sunrise }], hourly: [] }),
            }),
        });

        expect(result.initialSunrise?.toISOString()).toBe('2026-05-05T11:41:00.000Z');
    });

    it('returns initialSunrise = null when the boot weather fetch throws (graceful degrade)', async () => {
        const result = await runBootSequence({
            morningTickMinutesAfterSunrise: 60,
            deps: buildDeps({
                zonesRepo: buildZonesRepo([createTestZone({ id: 'zone-001', location: { lat: 51, lon: -114 } })]),
                getWeather: async () => { throw new Error('Open-Meteo down'); },
            }),
        });

        expect(result.initialSunrise).toBeNull();
        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining('boot weather fetch failed'),
            expect.any(Error),
        );
    });

    it('returns initialSunrise = null when no enabled zone has a location', async () => {
        const result = await runBootSequence({
            morningTickMinutesAfterSunrise: 60,
            deps: buildDeps({
                zonesRepo: buildZonesRepo([createTestZone({ id: 'zone-001', location: undefined })]),
            }),
        });

        expect(result.initialSunrise).toBeNull();
    });

    it('skips arming future cycles when the kill switch is off', async () => {
        bootSystemService({
            repo: {
                findSingleton: async () => ({ irrigationEnabled: false, since: NOW }),
                upsertSingleton: async () => {},
            },
        });
        const opens: string[] = [];
        const future = [{
            cycle: { id: 'cycle-existing', startTime: new Date('2026-05-04T13:00:00.000Z'), durationMin: 60, entryDate: '2026-05-04' },
            zone: createTestZone({ id: 'zone-001' }),
        }];

        await runBootSequence({
            morningTickMinutesAfterSunrise: 60,
            deps: buildDeps({
                zonesRepo: buildZonesRepo([createTestZone({ id: 'zone-001' })]),
                scheduleEntriesRepo: buildScheduleEntriesRepo(future),
                openZone: async (z) => { opens.push(z.id); },
            }),
        });

        expect(opens).toEqual([]);
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('skipping arm of 1 future cycle(s)'));
    });

    it('warns when there are zero zones to manage', async () => {
        await runBootSequence({
            morningTickMinutesAfterSunrise: 60,
            deps: buildDeps({
                zonesRepo: buildZonesRepo([], 0, 0),
            }),
        });

        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('has no zones to manage'));
    });

    it('warns when zones exist but none are enabled', async () => {
        await runBootSequence({
            morningTickMinutesAfterSunrise: 60,
            deps: buildDeps({
                zonesRepo: buildZonesRepo([], 3, 0),
            }),
        });

        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('all zones are disabled'));
    });
});
