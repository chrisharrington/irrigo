import { describe, expect, it } from 'bun:test';
import dayjs from 'dayjs';
import type { AlertEvent, Alerter, AlertsDb } from '@/alerts';
import type { ZoneActuationInterval } from '@/data/home-assistant';
import { createTestZone } from '@/mock/zone';
import type { HourlyWeather, WeatherData, Zone } from '@/models';
import type { PersistedCycle } from '@/models/cycle';
import type { ScheduleEntriesRepository } from '@/repositories/schedule-entries';
import type { Schedule } from '@/repositories/schedules';
import type { RecordWeatherSnapshotInput, WeatherSnapshotsRepository } from '@/repositories/weather-snapshots';
import type { WeatherStateRepository } from '@/repositories/weather-state';
import type { ZonesRepository } from '@/repositories/zones';
import type { Clock } from '../runtime';
import { runTickForZone, type TickDeps } from '.';

const SITE_TIMEZONE = 'UTC';
const NOW = new Date('2026-05-04T20:00:00.000Z');

function buildClock(now: Date = NOW): Clock {
    return {
        now: () => now,
        setTimeout: () => 0 as unknown as ReturnType<typeof setTimeout>,
        clearTimeout: () => {},
    };
}

function buildSchedule(overrides?: Partial<Schedule>): Schedule {
    return {
        id: 'sched-001',
        name: 'maintenance',
        slug: 'maintenance',
        siteId: 'test-site-001',
        isActive: true,
        allowedDays: null,
        allowedTimeWindows: null,
        rootDepthMOverride: null,
        allowableDepletionFractionOverride: null,
        endBySunrise: false,
        skippedNightDate: null,
        createdAt: NOW,
        updatedAt: NOW,
        ...overrides,
    } as Schedule;
}

function recordingAlerter(): { alerter: Alerter; calls: AlertEvent[] } {
    const calls: AlertEvent[] = [];
    const alerter: Alerter = async (event) => { calls.push(event); };
    return { alerter, calls };
}

type DepletionAdvance = { zoneId: string; depletionMm: number; reconciledAt: Date };

function buildDeps(overrides?: {
    getWeather?: (zone: Zone) => Promise<WeatherData>;
    getZoneActuationHistory?: (zone: Zone, since: Date, until: Date) => Promise<ZoneActuationInterval[]>;
    runPlan?: TickDeps['runPlan'];
    alerter?: Alerter;
    weatherIsStale?: boolean;
    onAdvanceDepletion?: (advance: DepletionAdvance) => void;
    onReplaceForZone?: () => Array<PersistedCycle>;
    snapshotRecordThrows?: boolean;
}): { deps: TickDeps; depletionAdvances: DepletionAdvance[]; alertCalls: AlertEvent[]; snapshotRecords: RecordWeatherSnapshotInput[] } {
    const depletionAdvances: DepletionAdvance[] = [];
    const { alerter, calls: alertCalls } = overrides?.alerter ? { alerter: overrides.alerter, calls: [] as AlertEvent[] } : recordingAlerter();
    const zonesRepo: ZonesRepository = {
        loadEnabled: async () => [],
        findById: async () => null,
        count: async () => ({ total: 0, enabled: 0 }),
        loadJoinedRowsForSummary: async () => [],
        loadLatestFires: async () => [],
        advanceDepletion: async (zoneId, depletionMm, reconciledAt) => {
            const advance = { zoneId, depletionMm, reconciledAt };
            depletionAdvances.push(advance);
            overrides?.onAdvanceDepletion?.(advance);
        },
    };
    const scheduleEntriesRepo: ScheduleEntriesRepository = {
        loadFutureCycles: async () => [],
        loadInFlightCycles: async () => [],
        replaceForZone: async () => ({ cycles: overrides?.onReplaceForZone?.() ?? [] }),
        markCycleFired: async () => {},
        markCycleClosed: async () => {},
        findScheduledFromDate: async () => [],
    };
    const weatherStateRepo: WeatherStateRepository = {
        markFetchSuccessful: async () => {},
        isStale: async () => overrides?.weatherIsStale ?? false,
    };
    const snapshotRecords: RecordWeatherSnapshotInput[] = [];
    const weatherSnapshotsRepo: WeatherSnapshotsRepository = {
        record: async (input) => {
            if (overrides?.snapshotRecordThrows) throw new Error('snapshot write failed');
            snapshotRecords.push(input);
            return 'snapshot-test';
        },
    };
    return {
        deps: {
            clock: buildClock(),
            alerter,
            runPlan: overrides?.runPlan ?? (async () => ({ entries: [], projectedNextDepletionMm: 0 })),
            getWeather: overrides?.getWeather ?? (async () => ({ daily: [], hourly: [] })),
            getZoneActuationHistory: overrides?.getZoneActuationHistory ?? (async () => []),
            zonesRepo,
            scheduleEntriesRepo,
            weatherStateRepo,
            weatherSnapshotsRepo,
            getAlertsDb: () => null as unknown as AlertsDb,
        },
        depletionAdvances,
        alertCalls,
        snapshotRecords,
    };
}

function mkHourly(timeIso: string, precipitationMm: number, evapotranspirationMm: number): HourlyWeather {
    return { time: dayjs(timeIso), precipitationMm, evapotranspirationMm };
}

describe('runTickForZone — morning', () => {
    it('reconciles depletion against HA actuation history and observed weather', async () => {
        const reconciledAt = new Date('2026-05-04T08:00:00.000Z');
        const zone = createTestZone({
            id: 'zone-001',
            currentDepletionMm: 10,
            currentDepletionReconciledAt: reconciledAt,
            precipitationRateMmPerHr: 9,
        });
        const { deps, depletionAdvances } = buildDeps({
            getWeather: async () => ({
                daily: [],
                hourly: [mkHourly('2026-05-04T10:00:00Z', 0, 1)],
            }),
            getZoneActuationHistory: async () => ([
                { onAt: new Date('2026-05-04T09:00:00Z'), offAt: new Date('2026-05-04T09:30:00Z') },
                { onAt: new Date('2026-05-04T10:00:00Z'), offAt: new Date('2026-05-04T10:30:00Z') },
            ]),
        });

        await runTickForZone({
            zone,
            activeSchedule: buildSchedule(),
            today: dayjs(NOW).tz(SITE_TIMEZONE),
            busyWindows: [],
            pastWindow: { start: new Date(0), end: NOW },
            tickKind: 'morning',
            isScheduledTick: true,
            irrigationEnabled: true,
            morningTickMinutesAfterSunrise: 60,
            deps,
        });

        // 10 + 1 - 0 - 9 = 2 mm
        expect(depletionAdvances).toHaveLength(1);
        expect(depletionAdvances[0]?.depletionMm).toBeCloseTo(2, 6);
        expect(depletionAdvances[0]?.reconciledAt).toEqual(NOW);
    });

    it('raises actuation-stale and falls through to weather-only advance when HA history fetch throws', async () => {
        const reconciledAt = new Date('2026-05-04T08:00:00.000Z');
        const zone = createTestZone({
            id: 'zone-001',
            name: 'North',
            currentDepletionMm: 5,
            currentDepletionReconciledAt: reconciledAt,
        });
        const { deps, depletionAdvances, alertCalls } = buildDeps({
            getWeather: async () => ({
                daily: [],
                hourly: [mkHourly('2026-05-04T10:00:00Z', 0, 2)],
            }),
            getZoneActuationHistory: async () => { throw new Error('HA fetch ECONNREFUSED'); },
        });

        await runTickForZone({
            zone,
            activeSchedule: buildSchedule(),
            today: dayjs(NOW).tz(SITE_TIMEZONE),
            busyWindows: [],
            pastWindow: { start: new Date(0), end: NOW },
            tickKind: 'morning',
            isScheduledTick: true,
            irrigationEnabled: true,
            morningTickMinutesAfterSunrise: 60,
            deps,
        });

        // 5 + 2 = 7 (no actuation deduction because history threw).
        expect(depletionAdvances[0]?.depletionMm).toBeCloseTo(7, 6);
        const stale = alertCalls.filter(a => a.class === 'actuation-stale');
        expect(stale).toHaveLength(1);
        expect(stale[0]).toMatchObject({ class: 'actuation-stale', tone: 'warn', zoneId: 'zone-001', zoneName: 'North' });
    });
});

describe('runTickForZone — evening', () => {
    it('advances depletion from observed weather only', async () => {
        const reconciledAt = new Date('2026-05-04T08:00:00.000Z');
        const zone = createTestZone({
            id: 'zone-001',
            currentDepletionMm: 5,
            currentDepletionReconciledAt: reconciledAt,
        });
        const { deps, depletionAdvances } = buildDeps({
            getWeather: async () => ({
                daily: [],
                hourly: [mkHourly('2026-05-04T15:00:00Z', 0, 2)],
            }),
        });

        await runTickForZone({
            zone,
            activeSchedule: buildSchedule(),
            today: dayjs(NOW).tz(SITE_TIMEZONE),
            busyWindows: [],
            pastWindow: { start: new Date(0), end: NOW },
            tickKind: 'evening',
            isScheduledTick: true,
            irrigationEnabled: true,
            morningTickMinutesAfterSunrise: 60,
            deps,
        });

        expect(depletionAdvances[0]?.depletionMm).toBeCloseTo(7, 6);
    });

    it('clamps depletion to zero when rain exceeds the deficit', async () => {
        const reconciledAt = new Date('2026-05-04T08:00:00.000Z');
        const zone = createTestZone({
            id: 'zone-001',
            currentDepletionMm: 3,
            currentDepletionReconciledAt: reconciledAt,
        });
        const { deps, depletionAdvances } = buildDeps({
            getWeather: async () => ({
                daily: [],
                hourly: [mkHourly('2026-05-04T15:00:00Z', 50, 1)],
            }),
        });

        await runTickForZone({
            zone,
            activeSchedule: buildSchedule(),
            today: dayjs(NOW).tz(SITE_TIMEZONE),
            busyWindows: [],
            pastWindow: { start: new Date(0), end: NOW },
            tickKind: 'evening',
            isScheduledTick: true,
            irrigationEnabled: true,
            morningTickMinutesAfterSunrise: 60,
            deps,
        });

        expect(depletionAdvances[0]?.depletionMm).toBe(0);
    });
});

describe('runTickForZone — kill switch and fresh seed', () => {
    it('stamps reconciledAt without advancing depletion when the prior anchor is null', async () => {
        const zone = createTestZone({
            id: 'zone-001',
            currentDepletionMm: 12.4,
            currentDepletionReconciledAt: undefined,
        });
        const { deps, depletionAdvances } = buildDeps({
            getWeather: async () => ({
                daily: [],
                // Even heavy rain should be ignored on the first tick.
                hourly: [mkHourly('2026-05-04T15:00:00Z', 50, 0)],
            }),
        });

        await runTickForZone({
            zone,
            activeSchedule: buildSchedule(),
            today: dayjs(NOW).tz(SITE_TIMEZONE),
            busyWindows: [],
            pastWindow: { start: new Date(0), end: NOW },
            tickKind: 'evening',
            isScheduledTick: true,
            irrigationEnabled: true,
            morningTickMinutesAfterSunrise: 60,
            deps,
        });

        expect(depletionAdvances[0]?.depletionMm).toBeCloseTo(12.4, 6);
    });

    it('still reconciles depletion when irrigation is disabled, but skips planning', async () => {
        const reconciledAt = new Date('2026-05-04T08:00:00.000Z');
        const zone = createTestZone({
            id: 'zone-001',
            currentDepletionMm: 4,
            currentDepletionReconciledAt: reconciledAt,
            precipitationRateMmPerHr: 9,
        });
        let runPlanCalls = 0;
        const { deps, depletionAdvances } = buildDeps({
            getWeather: async () => ({
                daily: [],
                hourly: [mkHourly('2026-05-04T10:00:00Z', 0, 1)],
            }),
            getZoneActuationHistory: async () => ([
                { onAt: new Date('2026-05-04T09:00:00Z'), offAt: new Date('2026-05-04T09:20:00Z') },
            ]),
            runPlan: async () => {
                runPlanCalls += 1;
                return { entries: [], projectedNextDepletionMm: 999 };
            },
        });

        const result = await runTickForZone({
            zone,
            activeSchedule: buildSchedule(),
            today: dayjs(NOW).tz(SITE_TIMEZONE),
            busyWindows: [],
            pastWindow: { start: new Date(0), end: NOW },
            tickKind: 'morning',
            isScheduledTick: true,
            irrigationEnabled: false,
            morningTickMinutesAfterSunrise: 60,
            deps,
        });

        // 4 + 1 - 0 - 3 = 2 mm reconciled despite kill switch.
        expect(depletionAdvances[0]?.depletionMm).toBeCloseTo(2, 6);
        expect(runPlanCalls).toBe(0);
        expect(result.cyclesToArm).toEqual([]);
    });
});

describe('runTickForZone — weather failure', () => {
    it('raises weather-stale when getWeather throws and the state is stale', async () => {
        const zone = createTestZone({ id: 'zone-001', name: 'North' });
        const { deps, alertCalls } = buildDeps({
            getWeather: async () => { throw new Error('Open-Meteo down'); },
            weatherIsStale: true,
        });

        const result = await runTickForZone({
            zone,
            activeSchedule: buildSchedule(),
            today: dayjs(NOW).tz(SITE_TIMEZONE),
            busyWindows: [],
            pastWindow: { start: new Date(0), end: NOW },
            tickKind: 'evening',
            isScheduledTick: true,
            irrigationEnabled: true,
            morningTickMinutesAfterSunrise: 60,
            deps,
        });

        const weatherAlerts = alertCalls.filter(a => a.class === 'weather-stale');
        expect(weatherAlerts).toHaveLength(1);
        expect(weatherAlerts[0]).toMatchObject({ tone: 'warn', title: 'Weather API stale', zoneName: 'North' });
        expect(result).toEqual({ cyclesToArm: [], newBusyWindows: [], observedSunrise: null });
    });

    it('returns empty cyclesToArm without raising weather-stale when the state is fresh', async () => {
        const zone = createTestZone({ id: 'zone-001' });
        const { deps, alertCalls } = buildDeps({
            getWeather: async () => { throw new Error('transient blip'); },
            weatherIsStale: false,
        });

        await runTickForZone({
            zone,
            activeSchedule: buildSchedule(),
            today: dayjs(NOW).tz(SITE_TIMEZONE),
            busyWindows: [],
            pastWindow: { start: new Date(0), end: NOW },
            tickKind: 'evening',
            isScheduledTick: true,
            irrigationEnabled: true,
            morningTickMinutesAfterSunrise: 60,
            deps,
        });

        expect(alertCalls.filter(a => a.class === 'weather-stale')).toHaveLength(0);
    });
});

describe('runTickForZone — observedSunrise reporting', () => {
    it('returns the upcoming sunrise so the caller can refresh its anchor', async () => {
        const sunrise = dayjs('2026-05-05T11:41:00Z');
        const zone = createTestZone({ id: 'zone-001' });
        const { deps } = buildDeps({
            getWeather: async () => ({
                daily: [{ date: sunrise, sunrise }],
                hourly: [],
            }),
        });

        const result = await runTickForZone({
            zone,
            activeSchedule: buildSchedule(),
            today: dayjs(NOW).tz(SITE_TIMEZONE),
            busyWindows: [],
            pastWindow: { start: new Date(0), end: NOW },
            tickKind: 'evening',
            isScheduledTick: false,
            irrigationEnabled: true,
            morningTickMinutesAfterSunrise: 60,
            deps,
        });

        expect(result.observedSunrise?.toISOString()).toBe('2026-05-05T11:41:00.000Z');
    });
});

describe('runTickForZone — weather-snapshot persistence', () => {
    const baseInput = (zone: Zone, deps: TickDeps) => ({
        zone,
        activeSchedule: buildSchedule(),
        today: dayjs(NOW).tz(SITE_TIMEZONE),
        busyWindows: [],
        pastWindow: { start: new Date(0), end: NOW },
        tickKind: 'evening' as const,
        isScheduledTick: true,
        irrigationEnabled: true,
        morningTickMinutesAfterSunrise: 60,
        deps,
    });

    it('records a snapshot tagged with the zone coords, timezone, and fetched weather', async () => {
        const zone = createTestZone({
            id: 'zone-001',
            siteTimezone: 'America/Edmonton',
            location: { lat: 51.0447, lon: -114.0719 },
        });
        const weather: WeatherData = {
            daily: [{ date: dayjs('2026-05-04'), rainfallMm: 8, evapotranspirationMmPerDay: 4 }],
            hourly: [mkHourly('2026-05-04T10:00:00Z', 0.5, 0.1)],
        };
        const { deps, snapshotRecords } = buildDeps({ getWeather: async () => weather });

        await runTickForZone(baseInput(zone, deps));

        expect(snapshotRecords).toHaveLength(1);
        expect(snapshotRecords[0]).toMatchObject({
            zoneId: 'zone-001',
            latitude: 51.0447,
            longitude: -114.0719,
            timezone: 'America/Edmonton',
            fetchedAt: NOW,
            weather,
        });
    });

    it('does not record a snapshot when the weather fetch fails', async () => {
        const zone = createTestZone({ id: 'zone-001' });
        const { deps, snapshotRecords } = buildDeps({
            getWeather: async () => { throw new Error('Open-Meteo down'); },
            weatherIsStale: true,
        });

        await runTickForZone(baseInput(zone, deps));

        expect(snapshotRecords).toHaveLength(0);
    });

    it('continues the tick (reconciliation + planning) when the snapshot write fails — best-effort', async () => {
        const reconciledAt = new Date('2026-05-04T08:00:00.000Z');
        const zone = createTestZone({ id: 'zone-001', currentDepletionMm: 5, currentDepletionReconciledAt: reconciledAt });
        const { deps, depletionAdvances } = buildDeps({
            getWeather: async () => ({ daily: [], hourly: [mkHourly('2026-05-04T10:00:00Z', 0, 2)] }),
            snapshotRecordThrows: true,
        });

        const result = await runTickForZone(baseInput(zone, deps));

        // The snapshot write threw, but the tick still reconciled depletion and
        // returned a normal (non-empty-by-failure) result.
        expect(depletionAdvances).toHaveLength(1);
        expect(result).toMatchObject({ cyclesToArm: [], newBusyWindows: [] });
    });
});
