import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import type { AlertEvent, Alerter, AlertsDb } from '@/alerts';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { grassTypes, irrigationCycles, scheduleEntries, schedules, sites, soilTypes, weatherState, zones } from '@/db/schema';

dayjs.extend(utc);
dayjs.extend(timezone);
import type { IrrigationScheduleEntry, Zone } from '@/models';
import type { FutureCyclePair, PersistedCycle } from '@/models/cycle';
import type { ScheduleEntriesRepository } from '@/repositories/schedule-entries';
import type { Schedule, SchedulesRepository } from '@/repositories/schedules';
import type { SitesRepository } from '@/repositories/sites';
import type { WeatherStateRepository } from '@/repositories/weather-state';
import type { ZoneJoinedRow, ZonesRepository } from '@/repositories/zones';
import { joinedRowToZone } from '@/repositories/zones';
import type { NotificationContext, NotificationEvent, Notifier } from '@/notifications';
import { bootSystemService } from '@/service/system';
import { bootDaemonService, computeNextRePlanAt, start } from '.';
import type { Clock, TimerHandle } from './runtime';

const NOW = new Date('2026-05-04T12:00:00.000Z');

type RecordedNotification = { event: NotificationEvent; context: NotificationContext | undefined };

function recordingNotifier(): { notifier: Notifier; calls: RecordedNotification[] } {
    const calls: RecordedNotification[] = [];
    const notifier: Notifier = async (event, context) => {
        calls.push({ event, context });
    };
    return { notifier, calls };
}

function recordingAlerter(): { alerter: Alerter; calls: AlertEvent[] } {
    const calls: AlertEvent[] = [];
    const alerter: Alerter = async (event) => {
        calls.push(event);
    };
    return { alerter, calls };
}

function buildJoinedRow(overrides?: Partial<{
    zone: Partial<ZoneJoinedRow['zone']>;
    grassType: Partial<ZoneJoinedRow['grassType']>;
    soilType: Partial<ZoneJoinedRow['soilType']>;
    site: Partial<ZoneJoinedRow['site']>;
}>): ZoneJoinedRow {
    return {
        zone: {
            id: 'zone-001',
            slug: 'front-lawn',
            patch: 'a',
            siteId: 'site-001',
            name: 'Front Lawn',
            grassTypeId: 'grass-001',
            soilTypeId: 'soil-001',
            rootDepthM: 0.3,
            allowableDepletionFraction: 0.5,
            irrigationEfficiency: 0.8,
            flowRateLPerMin: 15,
            areaM2: 100,
            precipitationRateMmPerHr: 9,
            currentDepletionMm: 0,
            isEnabled: true,
            latitude: 51.0447,
            longitude: -114.0719,
            homeAssistantEntityId: 'switch.zone_1',
            microclimateFactor: 1,
            createdAt: NOW,
            updatedAt: NOW,
            ...overrides?.zone,
        },
        grassType: {
            id: 'grass-001',
            slug: 'kentucky-bluegrass',
            name: 'Kentucky Bluegrass',
            cropCoefficient: 0.85,
            createdAt: NOW,
            updatedAt: NOW,
            ...overrides?.grassType,
        },
        soilType: {
            id: 'soil-001',
            slug: 'loam',
            name: 'Loam',
            availableWaterHoldingCapacityMmPerM: 150,
            infiltrationRateMmPerHr: 25,
            createdAt: NOW,
            updatedAt: NOW,
            ...overrides?.soilType,
        },
        site: {
            id: 'site-001',
            slug: 'home',
            name: 'Home',
            timezone: 'America/Edmonton',
            latitude: 51.05,
            longitude: -114.07,
            address: null,
            createdAt: NOW,
            updatedAt: NOW,
            ...overrides?.site,
        },
    };
}

function buildFutureCycleRow(overrides?: {
    cycle?: Partial<{ id: string; startTime: Date; durationMin: number; firedAt: Date | null; closedAt: Date | null }>;
    scheduleEntry?: Partial<{ date: string }>;
    zone?: Partial<ZoneJoinedRow['zone']>;
    site?: Partial<ZoneJoinedRow['site']>;
}): FutureCyclePair {
    const base = buildJoinedRow({ zone: overrides?.zone, site: overrides?.site });
    return {
        cycle: {
            id: overrides?.cycle?.id ?? 'cycle-001',
            startTime: overrides?.cycle?.startTime ?? new Date('2026-05-05T05:00:00.000Z'),
            durationMin: overrides?.cycle?.durationMin ?? 25,
            entryDate: overrides?.scheduleEntry?.date ?? '2026-05-05',
        },
        zone: joinedRowToZone(base),
    };
}

function buildEntry(date: string, cycles: Array<{ startTime: string; durationMin: number }>): IrrigationScheduleEntry {
    return {
        date: dayjs(date),
        zoneId: 'zone-001',
        cycles: cycles.map(c => ({ startTime: dayjs(c.startTime), durationMin: c.durationMin })),
        appliedDepthMm: 12.0,
        depletionBeforeMm: 18.5,
        depletionAfterMm: 0,
    };
}

type ScheduledTimer = { handle: number; fireAt: number; cb: () => void };

function createFakeClock(initial: Date) {
    let currentMs = initial.getTime();
    let nextHandle = 1;
    const timers = new Map<number, ScheduledTimer>();

    const clock: Clock = {
        now: () => new Date(currentMs),
        setTimeout(cb, ms) {
            const handle = nextHandle++;
            const fireAt = currentMs + ms;
            timers.set(handle, { handle, fireAt, cb });
            return handle as TimerHandle;
        },
        clearTimeout(h) {
            timers.delete(h as number);
        },
    };

    async function flushMicrotasks(): Promise<void> {
        for (let i = 0; i < 50; i += 1) await new Promise<void>(resolve => setImmediate(resolve));
    }

    async function advanceTo(target: Date): Promise<void> {
        const targetMs = target.getTime();
        while (true) {
            let earliest: ScheduledTimer | undefined;
            for (const t of timers.values()) {
                if (t.fireAt > targetMs) continue;
                if (!earliest || t.fireAt < earliest.fireAt) earliest = t;
            }
            if (!earliest) break;
            timers.delete(earliest.handle);
            currentMs = earliest.fireAt;
            earliest.cb();
            await flushMicrotasks();
        }
        currentMs = targetMs;
    }

    return {
        clock,
        advanceTo,
        flushMicrotasks,
        getPendingCount: () => timers.size,
        getPendingDelays: () => [...timers.values()].map(t => t.fireAt - initial.getTime()),
    };
}

// ============================================================================
// Daemon repos stub — captures call effects for assertion.
// ============================================================================

type CycleUpdate = { cycleId: string; firedAt?: Date; closedAt?: Date };
type InsertCall = { table: unknown; rows: ReadonlyArray<Record<string, unknown>> };

type DefaultActiveSchedule = {
    id: string;
    siteId: string;
    slug: string;
    name: string;
    isActive: boolean;
    allowedDays: number[] | null;
    allowedTimeWindows: Array<{ start: string; end: string }> | null;
    rootDepthMOverride: number | null;
    allowableDepletionFractionOverride: number | null;
    endBySunrise: boolean | null;
    skippedNightDate?: string | null;
    createdAt: Date;
    updatedAt: Date;
};

type DaemonStubInputs = {
    futureCycles?: FutureCyclePair[];
    inFlightCycles?: FutureCyclePair[];
    enabledZones?: ZoneJoinedRow[];
    zoneCounts?: { total: number; enabled: number };
    siteTimezones?: ReadonlyArray<{ timezone: string }>;
    /** Seed value the weather_state stub returns; `undefined` ⇒ no row ⇒ stale. */
    lastSuccessfulFetchAt?: Date | null;
    activeSchedules?: ReadonlyArray<{ schedule: DefaultActiveSchedule }>;
    /** Force loadInFlightCycles to throw. Used to test reconcile-failure propagation. */
    inFlightCyclesError?: Error;
};

function createDaemonReposStub(inputs?: DaemonStubInputs) {
    const cycleUpdates: CycleUpdate[] = [];
    const zoneUpdates: Array<{ zoneId: string; currentDepletionMm: number }> = [];
    const inserts: InsertCall[] = [];
    const deletes: Array<{ table: unknown }> = [];
    const weatherStateUpserts: Array<Record<string, unknown>> = [];
    const alertTableUpdates: Array<{ set: Record<string, unknown>; cond: unknown }> = [];
    const schedulesTableUpdates: Array<{ set: Record<string, unknown> }> = [];

    let callOrder = 0;
    let firstClearStaleCallOrder: number | null = null;
    let firstActiveScheduleReadOrder: number | null = null;

    const counts = inputs?.zoneCounts ?? { total: 1, enabled: 1 };
    const siteTimezone = inputs?.siteTimezones?.[0]?.timezone ?? 'America/Edmonton';

    // Mutable copy of the seed enabledZones so depletion writes from rePlan
    // are reflected by subsequent loadEnabled calls (day-N reads day-(N-1)).
    const enabledZoneRows = inputs?.enabledZones?.map(row => ({ ...row, zone: { ...row.zone } })) ?? [];

    const defaultActiveSchedule: DefaultActiveSchedule = {
        id: 'sched-default',
        siteId: 'site-001',
        slug: 'maintenance',
        name: 'Maintenance',
        isActive: true,
        allowedDays: null,
        allowedTimeWindows: null,
        rootDepthMOverride: null,
        allowableDepletionFractionOverride: null,
        endBySunrise: null,
        skippedNightDate: null,
        createdAt: NOW,
        updatedAt: NOW,
    };
    const activeScheduleEntries = inputs?.activeSchedules ?? [{ schedule: defaultActiveSchedule }];

    const sitesRepo: SitesRepository = {
        loadTimezone: async () => siteTimezone,
    };

    const zonesRepo: ZonesRepository = {
        loadEnabled: async () => enabledZoneRows.filter(r => r.zone.isEnabled !== false).map(joinedRowToZone),
        findById: async () => null,
        count: async () => counts,
        loadJoinedRowsForSummary: async () => [],
        loadLatestScheduleEntries: async () => [],
    };

    let weatherStateRow: Date | null = inputs?.lastSuccessfulFetchAt ?? null;
    const weatherStateRepo: WeatherStateRepository = {
        markFetchSuccessful: async (now) => {
            weatherStateRow = now;
            weatherStateUpserts.push({ id: 'singleton', lastSuccessfulFetchAt: now });
        },
        isStale: async (now, threshold = 24 * 60 * 60 * 1000) => {
            if (weatherStateRow === null) return true;
            return now.getTime() - weatherStateRow.getTime() > threshold;
        },
    };

    const schedulesRepo: SchedulesRepository = {
        listAll: async () => [],
        loadActiveBySite: async () => {
            if (firstActiveScheduleReadOrder === null) firstActiveScheduleReadOrder = ++callOrder;
            const map = new Map<string, Schedule>();
            for (const entry of activeScheduleEntries) {
                const row: Schedule = {
                    id: entry.schedule.id,
                    siteId: entry.schedule.siteId,
                    slug: entry.schedule.slug,
                    name: entry.schedule.name,
                    isActive: entry.schedule.isActive,
                    allowedDays: entry.schedule.allowedDays,
                    allowedTimeWindows: entry.schedule.allowedTimeWindows,
                    rootDepthMOverride: entry.schedule.rootDepthMOverride,
                    allowableDepletionFractionOverride: entry.schedule.allowableDepletionFractionOverride,
                    endBySunrise: entry.schedule.endBySunrise,
                    skippedNightDate: entry.schedule.skippedNightDate ?? null,
                    createdAt: entry.schedule.createdAt,
                    updatedAt: entry.schedule.updatedAt,
                };
                map.set(row.siteId, row);
            }
            return map;
        },
        findBySlug: async () => null,
        enable: async () => null,
        disable: async () => null,
        skipActiveTonight: async () => null,
        resumeActiveTonight: async () => null,
        clearStaleSkipMarkers: async () => {
            if (firstClearStaleCallOrder === null) firstClearStaleCallOrder = ++callOrder;
            schedulesTableUpdates.push({ set: { skippedNightDate: null } });
        },
    };

    const scheduleEntriesRepo: ScheduleEntriesRepository = {
        loadFutureCycles: async () => inputs?.futureCycles ?? [],
        loadInFlightCycles: async () => {
            if (inputs?.inFlightCyclesError) throw inputs.inFlightCyclesError;
            return inputs?.inFlightCycles ?? [];
        },
        replaceForZone: async (zoneId, entries, _today, projectedNextDepletionMm, scheduleId) => {
            deletes.push({ table: scheduleEntries });
            const cycles: PersistedCycle[] = [];
            for (const entry of entries) {
                const entryDate = entry.date.format('YYYY-MM-DD');
                inserts.push({
                    table: scheduleEntries,
                    rows: [{
                        zoneId,
                        scheduleId,
                        date: entryDate,
                        appliedDepthMm: entry.appliedDepthMm,
                        depletionBeforeMm: entry.depletionBeforeMm,
                        depletionAfterMm: entry.depletionAfterMm,
                        sunriseAt: entry.sunriseAt?.toDate() ?? null,
                    }],
                });
                if (entry.cycles.length === 0) continue;
                inserts.push({
                    table: irrigationCycles,
                    rows: entry.cycles.map(c => ({
                        startTime: c.startTime.toDate(),
                        durationMin: c.durationMin,
                    })),
                });
                for (let i = 0; i < entry.cycles.length; i++) {
                    const c = entry.cycles[i]!;
                    cycles.push({
                        id: `cycle-${inserts.length}-${i}`,
                        startTime: c.startTime.toDate(),
                        durationMin: c.durationMin,
                        entryDate,
                    });
                }
            }
            zoneUpdates.push({ zoneId, currentDepletionMm: projectedNextDepletionMm });
            // Reflect the write back into the stubbed enabledZones so the next load returns it.
            for (const row of enabledZoneRows) {
                if (row.zone.id === zoneId) row.zone.currentDepletionMm = projectedNextDepletionMm;
            }
            return { cycles };
        },
        markCycleFired: async (cycleId, firedAt) => {
            cycleUpdates.push({ cycleId, firedAt });
        },
        markCycleClosed: async (cycleId, closedAt) => {
            cycleUpdates.push({ cycleId, closedAt });
        },
        findScheduledFromDate: async () => [],
    };

    const runAlertsUpdate = async (values: Record<string, unknown>, cond: unknown): Promise<void> => {
        alertTableUpdates.push({ set: values, cond });
    };
    const alertsDb = {
        update: () => ({ set: (values: Record<string, unknown>) => ({ where: (cond: unknown) => runAlertsUpdate(values, cond) }) }),
    } as unknown as AlertsDb;

    return {
        repos: { zones: zonesRepo, sites: sitesRepo, schedules: schedulesRepo, scheduleEntries: scheduleEntriesRepo, weatherState: weatherStateRepo },
        alertsDb,
        cycleUpdates,
        zoneUpdates,
        inserts,
        deletes,
        weatherStateUpserts,
        alertTableUpdates,
        schedulesTableUpdates,
        getOrdering: () => ({ clearStale: firstClearStaleCallOrder, activeScheduleRead: firstActiveScheduleReadOrder }),
    };
}

// ============================================================================
// Tests
// ============================================================================

describe('computeNextRePlanAt', () => {
    it('UTC: returns todays hour when the current time is before that hour', () => {
        const now = new Date('2026-05-04T01:30:00.000Z');
        const next = computeNextRePlanAt(now, 4, 'UTC');

        expect(next.toISOString()).toBe('2026-05-04T04:00:00.000Z');
    });

    it('UTC: returns tomorrows hour when the current time is past todays hour', () => {
        const now = new Date('2026-05-04T18:30:00.000Z');
        const next = computeNextRePlanAt(now, 4, 'UTC');

        expect(next.toISOString()).toBe('2026-05-05T04:00:00.000Z');
    });

    it('UTC: returns tomorrows hour when the current time exactly matches todays hour', () => {
        const now = new Date('2026-05-04T04:00:00.000Z');
        const next = computeNextRePlanAt(now, 4, 'UTC');

        expect(next.toISOString()).toBe('2026-05-05T04:00:00.000Z');
    });

    it('Edmonton MDT: maps local 04:00 to the correct UTC instant when now is before it', () => {
        const now = new Date('2026-05-04T01:30:00.000Z');
        const next = computeNextRePlanAt(now, 4, 'America/Edmonton');

        expect(next.toISOString()).toBe('2026-05-04T10:00:00.000Z');
    });

    it('Edmonton MDT: rolls to tomorrow when now is past local 04:00', () => {
        const now = new Date('2026-05-04T18:30:00.000Z');
        const next = computeNextRePlanAt(now, 4, 'America/Edmonton');

        expect(next.toISOString()).toBe('2026-05-05T10:00:00.000Z');
    });

    it('Edmonton MST: maps local 04:00 to the correct UTC instant outside DST', () => {
        const now = new Date('2026-01-15T18:30:00.000Z');
        const next = computeNextRePlanAt(now, 4, 'America/Edmonton');

        expect(next.toISOString()).toBe('2026-01-16T11:00:00.000Z');
    });
});

describe('start', () => {
    // Default the system kill-switch to enabled for every test. Kill-switch
    // tests below override this with their own bootSystemService call.
    beforeEach(() => {
        bootSystemService({
            repo: {
                findSingleton: async () => ({ irrigationEnabled: true, since: new Date('2026-05-04T08:00:00.000Z') }),
                upsertSingleton: async () => {},
            },
        });
    });

    it('arms each future cycle returned by the DB so it fires at its start_time', async () => {
        const futureRow = buildFutureCycleRow({
            cycle: { id: 'cycle-existing', startTime: new Date('2026-05-04T13:00:00.000Z'), durationMin: 10 },
        });
        const stub = createDaemonReposStub({ futureCycles: [futureRow] });
        bootDaemonService({ repos: stub.repos, alertsDb: stub.alertsDb });
        const { clock, advanceTo } = createFakeClock(NOW);
        const opens: string[] = [];
        const closes: string[] = [];

        await start({
            clock,
            rePlanHourLocal: 4,
            runPlan: async () => ({ entries: [], projectedNextDepletionMm: 0 }),
            openZone: async (z) => { opens.push(z.id); },
            closeZone: async (z) => { closes.push(z.id); },
        });

        await advanceTo(new Date('2026-05-04T13:10:01.000Z'));

        expect(opens).toEqual([futureRow.zone.id]);
        expect(closes).toEqual([futureRow.zone.id]);
    });

    it('schedules the next re-plan timer for the configured local hour (UTC)', async () => {
        const stub = createDaemonReposStub();
        bootDaemonService({ repos: stub.repos, alertsDb: stub.alertsDb });
        const { clock, getPendingDelays } = createFakeClock(NOW);

        await start({ clock, rePlanHourLocal: 4, siteTimezone: 'UTC' });

        const sixteenHoursMs = 16 * 60 * 60 * 1000;
        expect(getPendingDelays()).toContain(sixteenHoursMs);
    });

    it('schedules the next re-plan in the site timezone, not the container timezone', async () => {
        const stub = createDaemonReposStub();
        bootDaemonService({ repos: stub.repos, alertsDb: stub.alertsDb });
        const { clock, getPendingDelays } = createFakeClock(NOW);

        await start({ clock, rePlanHourLocal: 4, siteTimezone: 'America/Edmonton' });

        const twentyTwoHoursMs = 22 * 60 * 60 * 1000;
        expect(getPendingDelays()).toContain(twentyTwoHoursMs);
    });

    it('defaults `rePlanHourLocal` to 20 — schedules the first re-plan at the next 20:00 local (API-68)', async () => {
        // NOW = 2026-05-04T12:00:00.000Z. With UTC site timezone and the new
        // default hour of 20, the next re-plan should fire 8h later at
        // 2026-05-04T20:00:00.000Z.
        const stub = createDaemonReposStub();
        bootDaemonService({ repos: stub.repos, alertsDb: stub.alertsDb });
        const { clock, getPendingDelays } = createFakeClock(NOW);

        await start({ clock, siteTimezone: 'UTC' });

        const eightHoursMs = 8 * 60 * 60 * 1000;
        expect(getPendingDelays()).toContain(eightHoursMs);
    });

    it('returned rePlan() runs the planner for every enabled zone and inserts the planner output', async () => {
        const enabledRow = buildJoinedRow({ zone: { id: 'zone-loaded', name: 'Loaded Zone' } });
        const stub = createDaemonReposStub({ enabledZones: [enabledRow] });
        bootDaemonService({ repos: stub.repos, alertsDb: stub.alertsDb });
        const { clock } = createFakeClock(NOW);
        const planned: IrrigationScheduleEntry[] = [
            buildEntry('2026-05-04', [{ startTime: '2026-05-04T13:00:00Z', durationMin: 20 }]),
        ];

        const control = await start({
            clock,
            rePlanHourLocal: 4,
            runPlan: async () => ({ entries: planned, projectedNextDepletionMm: 0 }),
            openZone: async () => {},
            closeZone: async () => {},
        });

        await control.rePlan();

        expect(stub.deletes.length).toBeGreaterThanOrEqual(1);
        expect(stub.inserts.filter(c => c.table === scheduleEntries)).toHaveLength(1);
        expect(stub.inserts.filter(c => c.table === irrigationCycles)).toHaveLength(1);
    });

    it('rePlan() cancels pending open timers from the previous plan', async () => {
        const futureRow = buildFutureCycleRow({
            cycle: { id: 'cycle-old', startTime: new Date('2026-05-04T15:00:00.000Z'), durationMin: 20 },
        });
        const enabledRow = buildJoinedRow({ zone: { id: 'zone-loaded' } });
        const stub = createDaemonReposStub({ futureCycles: [futureRow], enabledZones: [enabledRow] });
        bootDaemonService({ repos: stub.repos, alertsDb: stub.alertsDb });
        const { clock, advanceTo } = createFakeClock(NOW);
        const opens: string[] = [];

        const control = await start({
            clock,
            rePlanHourLocal: 4,
            runPlan: async () => ({ entries: [], projectedNextDepletionMm: 0 }),
            openZone: async (z) => { opens.push(z.id); },
            closeZone: async () => {},
        });

        await control.rePlan();
        await advanceTo(new Date('2026-05-04T15:30:00.000Z'));

        expect(opens).toEqual([]);
    });

    it('rePlan() logs and continues when the planner throws for a single zone', async () => {
        const enabledRows = [
            buildJoinedRow({ zone: { id: 'zone-bad' } }),
            buildJoinedRow({ zone: { id: 'zone-good' } }),
        ];
        const stub = createDaemonReposStub({ enabledZones: enabledRows });
        bootDaemonService({ repos: stub.repos, alertsDb: stub.alertsDb });
        const { clock } = createFakeClock(NOW);
        const planned = buildEntry('2026-05-04', [{ startTime: '2026-05-04T13:00:00Z', durationMin: 20 }]);

        const control = await start({
            clock,
            rePlanHourLocal: 4,
            runPlan: async (z) => {
                if (z.id === 'zone-bad') throw new Error('plan failed');
                return { entries: [planned], projectedNextDepletionMm: 0 };
            },
            getZoneState: async () => 'off',
            openZone: async () => {},
            closeZone: async () => {},
        });

        await control.rePlan();

        expect(stub.inserts.filter(c => c.table === scheduleEntries)).toHaveLength(1);
    });

    it('rePlan() marks weather-fetch-successful and clears weather-stale alerts after a successful zone plan', async () => {
        const enabledRows = [buildJoinedRow({ zone: { id: 'zone-good' } })];
        const stub = createDaemonReposStub({ enabledZones: enabledRows });
        bootDaemonService({ repos: stub.repos, alertsDb: stub.alertsDb });
        const { clock } = createFakeClock(NOW);
        const planned = buildEntry('2026-05-04', [{ startTime: '2026-05-04T13:00:00Z', durationMin: 15 }]);

        const control = await start({
            clock,
            rePlanHourLocal: 4,
            runPlan: async () => ({ entries: [planned], projectedNextDepletionMm: 0 }),
            getZoneState: async () => 'off',
            openZone: async () => {},
            closeZone: async () => {},
        });

        await control.rePlan();

        expect(stub.weatherStateUpserts).toHaveLength(1);
        expect(stub.weatherStateUpserts[0]).toMatchObject({ id: 'singleton' });
        expect(stub.weatherStateUpserts[0]!['lastSuccessfulFetchAt']).toBeInstanceOf(Date);
        expect(stub.alertTableUpdates).toHaveLength(1);
        expect(stub.alertTableUpdates[0]!.set).toEqual({ ack: true });
    });

    it('rePlan() records a weather-stale alert when the planner throws and no recent fetch is on record', async () => {
        const enabledRows = [buildJoinedRow({ zone: { id: 'zone-bad', name: 'North' } })];
        const stub = createDaemonReposStub({ enabledZones: enabledRows });
        bootDaemonService({ repos: stub.repos, alertsDb: stub.alertsDb });
        const { clock } = createFakeClock(NOW);
        const { alerter, calls: alertCalls } = recordingAlerter();

        const control = await start({
            clock,
            rePlanHourLocal: 4,
            runPlan: async () => { throw new Error('weather: Open-Meteo network error'); },
            getZoneState: async () => 'off',
            openZone: async () => {},
            closeZone: async () => {},
            alerter,
        });

        await control.rePlan();

        const weatherAlerts = alertCalls.filter(a => a.class === 'weather-stale');
        expect(weatherAlerts).toHaveLength(1);
        expect(weatherAlerts[0]).toMatchObject({ class: 'weather-stale', tone: 'warn', title: 'Weather API stale' });
        expect(weatherAlerts[0]!.zoneId).toBeUndefined();
    });

    it('rePlan() does NOT record a weather-stale alert when a recent successful fetch is on record', async () => {
        const enabledRows = [buildJoinedRow({ zone: { id: 'zone-bad' } })];
        const stub = createDaemonReposStub({
            enabledZones: enabledRows,
            lastSuccessfulFetchAt: new Date(NOW.getTime() - 60_000),
        });
        bootDaemonService({ repos: stub.repos, alertsDb: stub.alertsDb });
        const { clock } = createFakeClock(NOW);
        const { alerter, calls: alertCalls } = recordingAlerter();

        const control = await start({
            clock,
            rePlanHourLocal: 4,
            runPlan: async () => { throw new Error('transient error'); },
            getZoneState: async () => 'off',
            openZone: async () => {},
            closeZone: async () => {},
            alerter,
        });

        await control.rePlan();

        expect(alertCalls.some(a => a.class === 'weather-stale')).toBe(false);
    });

    it('shutdown() cancels pending timers and closes any in-flight relay', async () => {
        const futureRow = buildFutureCycleRow({
            cycle: { id: 'cycle-inflight', startTime: new Date('2026-05-04T13:00:00.000Z'), durationMin: 60 },
        });
        const stub = createDaemonReposStub({ futureCycles: [futureRow] });
        bootDaemonService({ repos: stub.repos, alertsDb: stub.alertsDb });
        const { clock, advanceTo } = createFakeClock(NOW);
        const opens: string[] = [];
        const closes: string[] = [];

        const control = await start({
            clock,
            rePlanHourLocal: 4,
            runPlan: async () => ({ entries: [], projectedNextDepletionMm: 0 }),
            openZone: async (z) => { opens.push(z.id); },
            closeZone: async (z) => { closes.push(z.id); },
        });

        await advanceTo(new Date('2026-05-04T13:05:00.000Z'));
        expect(opens).toHaveLength(1);
        expect(closes).toEqual([]);

        await control.shutdown();

        expect(closes).toEqual([futureRow.zone.id]);
    });

    it('shutdown() with no in-flight cycles only cancels timers and resolves quickly', async () => {
        const stub = createDaemonReposStub();
        bootDaemonService({ repos: stub.repos, alertsDb: stub.alertsDb });
        const { clock } = createFakeClock(NOW);
        const closes: string[] = [];

        const control = await start({
            clock,
            rePlanHourLocal: 4,
            runPlan: async () => ({ entries: [], projectedNextDepletionMm: 0 }),
            openZone: async () => {},
            closeZone: async (z) => { closes.push(z.id); },
        });

        await control.shutdown();

        expect(closes).toEqual([]);
    });

    it('the scheduled re-plan timer fires runPlan automatically when its time elapses', async () => {
        const enabledRow = buildJoinedRow({ zone: { id: 'zone-loaded' } });
        const stub = createDaemonReposStub({ enabledZones: [enabledRow] });
        bootDaemonService({ repos: stub.repos, alertsDb: stub.alertsDb });
        const { clock, advanceTo } = createFakeClock(NOW);
        const planCalls: string[] = [];

        await start({
            clock,
            rePlanHourLocal: 4,
            siteTimezone: 'UTC',
            runPlan: async (z) => {
                planCalls.push(z.id);
                return { entries: [], projectedNextDepletionMm: 0 };
            },
            openZone: async () => {},
            closeZone: async () => {},
        });

        await advanceTo(new Date('2026-05-05T04:00:01.000Z'));

        expect(planCalls).toContain('zone-loaded');
    });

    it('exposes alive=true and a null lastRePlanAt with no activeZones immediately after boot', async () => {
        const stub = createDaemonReposStub();
        bootDaemonService({ repos: stub.repos, alertsDb: stub.alertsDb });
        const { clock } = createFakeClock(NOW);

        const control = await start({ clock, rePlanHourLocal: 4 });

        expect(control.getStatus()).toEqual({ alive: true, lastRePlanAt: null, activeZones: [] });
    });

    it('records lastRePlanAt as the ISO timestamp at which rePlan() finished', async () => {
        const enabledRow = buildJoinedRow({ zone: { id: 'zone-loaded' } });
        const stub = createDaemonReposStub({ enabledZones: [enabledRow] });
        bootDaemonService({ repos: stub.repos, alertsDb: stub.alertsDb });
        const { clock } = createFakeClock(NOW);

        const control = await start({
            clock,
            rePlanHourLocal: 4,
            runPlan: async () => ({ entries: [], projectedNextDepletionMm: 0 }),
            openZone: async () => {},
            closeZone: async () => {},
        });

        await control.rePlan();

        expect(control.getStatus().lastRePlanAt).toBe(clock.now().toISOString());
    });

    it('reports an in-flight cycles zone in activeZones during the open-to-close window', async () => {
        const futureRow = buildFutureCycleRow({
            cycle: { id: 'cycle-active', startTime: new Date('2026-05-04T13:00:00.000Z'), durationMin: 30 },
            zone: { id: 'zone-active', name: 'Active Zone' },
        });
        const stub = createDaemonReposStub({ futureCycles: [futureRow] });
        bootDaemonService({ repos: stub.repos, alertsDb: stub.alertsDb });
        const { clock, advanceTo } = createFakeClock(NOW);

        const control = await start({
            clock,
            rePlanHourLocal: 4,
            runPlan: async () => ({ entries: [], projectedNextDepletionMm: 0 }),
            openZone: async () => {},
            closeZone: async () => {},
        });

        await advanceTo(new Date('2026-05-04T13:05:00.000Z'));
        expect(control.getStatus().activeZones).toEqual([{ id: 'zone-active', name: 'Active Zone' }]);

        await advanceTo(new Date('2026-05-04T13:30:01.000Z'));
        expect(control.getStatus().activeZones).toEqual([]);
    });

    it('rePlan() does not cancel the close timer of an already-fired cycle', async () => {
        const futureRow = buildFutureCycleRow({
            cycle: { id: 'cycle-running', startTime: new Date('2026-05-04T13:00:00.000Z'), durationMin: 30 },
        });
        const stub = createDaemonReposStub({ futureCycles: [futureRow], enabledZones: [] });
        bootDaemonService({ repos: stub.repos, alertsDb: stub.alertsDb });
        const { clock, advanceTo } = createFakeClock(NOW);
        const opens: string[] = [];
        const closes: string[] = [];

        const control = await start({
            clock,
            rePlanHourLocal: 4,
            runPlan: async () => ({ entries: [], projectedNextDepletionMm: 0 }),
            openZone: async (z) => { opens.push(z.id); },
            closeZone: async (z) => { closes.push(z.id); },
        });

        await advanceTo(new Date('2026-05-04T13:00:01.000Z'));
        expect(opens).toHaveLength(1);
        expect(closes).toEqual([]);

        await control.rePlan();
        await advanceTo(new Date('2026-05-04T13:30:01.000Z'));

        expect(closes).toEqual([futureRow.zone.id]);
    });

    it('persists projected depletion so the next rePlan reads the updated value, not the seed', async () => {
        const enabledRow = buildJoinedRow({ zone: { id: 'zone-001', currentDepletionMm: 0 } });
        const stub = createDaemonReposStub({ enabledZones: [enabledRow] });
        bootDaemonService({ repos: stub.repos, alertsDb: stub.alertsDb });
        const { clock } = createFakeClock(NOW);
        const seenDepletionsByCall: number[] = [];

        const control = await start({
            clock,
            rePlanHourLocal: 4,
            runPlan: async zone => {
                seenDepletionsByCall.push(zone.currentDepletionMm);
                return { entries: [], projectedNextDepletionMm: 7.5 };
            },
            openZone: async () => {},
            closeZone: async () => {},
        });

        await control.rePlan();
        await control.rePlan();

        expect(stub.zoneUpdates).toEqual([
            { zoneId: 'zone-001', currentDepletionMm: 7.5 },
            { zoneId: 'zone-001', currentDepletionMm: 7.5 },
        ]);
        expect(seenDepletionsByCall).toEqual([0, 7.5]);
    });

    it('does not emit schedule-begun or schedule-ended for boot-armed cycles', async () => {
        const futureRow = buildFutureCycleRow({
            cycle: { id: 'cycle-boot', startTime: new Date('2026-05-04T11:00:00.000Z'), durationMin: 8 },
            zone: { id: 'zone-boot', name: 'Boot Zone' },
        });
        const stub = createDaemonReposStub({ futureCycles: [futureRow] });
        bootDaemonService({ repos: stub.repos, alertsDb: stub.alertsDb });
        const { clock, advanceTo } = createFakeClock(NOW);
        const { notifier, calls } = recordingNotifier();

        await start({
            clock,
            rePlanHourLocal: 4,
            siteTimezone: 'UTC',
            notifier,
            runPlan: async () => ({ entries: [], projectedNextDepletionMm: 0 }),
            openZone: async () => {},
            closeZone: async () => {},
        });

        await advanceTo(new Date('2026-05-04T12:08:30.000Z'));

        expect(calls.some(c => c.event === 'schedule-begun')).toBe(false);
        expect(calls.some(c => c.event === 'schedule-ended')).toBe(false);
        expect(calls.some(c => c.event === 'watering-started')).toBe(false);
        expect(calls.some(c => c.event === 'watering-ended')).toBe(false);
    });

    it('rePlan tags the earliest cycle with schedule-begun and the latest with schedule-ended', async () => {
        const enabledRow = buildJoinedRow({ zone: { id: 'zone-rp', name: 'Replan Zone' } });
        const stub = createDaemonReposStub({ enabledZones: [enabledRow] });
        bootDaemonService({ repos: stub.repos, alertsDb: stub.alertsDb });
        const { clock, advanceTo } = createFakeClock(NOW);
        const { notifier, calls } = recordingNotifier();
        const planned = buildEntry('2026-05-04', [
            { startTime: '2026-05-04T13:00:00Z', durationMin: 6 },
            { startTime: '2026-05-04T14:00:00Z', durationMin: 6 },
        ]);

        const control = await start({
            clock,
            rePlanHourLocal: 4,
            siteTimezone: 'UTC',
            notifier,
            runPlan: async () => ({ entries: [planned], projectedNextDepletionMm: 0 }),
            openZone: async () => {},
            closeZone: async () => {},
        });

        await control.rePlan();
        await advanceTo(new Date('2026-05-04T14:06:30.000Z'));

        const begunCalls = calls.filter(c => c.event === 'schedule-begun');
        expect(begunCalls).toHaveLength(1);
        expect(begunCalls[0]?.context).toEqual({ scheduleNight: '2026-05-04' });

        const endedCalls = calls.filter(c => c.event === 'schedule-ended');
        expect(endedCalls).toHaveLength(1);
        expect(endedCalls[0]?.context).toMatchObject({
            scheduleNight: '2026-05-04',
            perZoneRuntimeMin: { 'Replan Zone': 12 },
            siteTimezone: 'UTC',
        });
        expect(endedCalls[0]?.context).not.toHaveProperty('nextIrrigation');
    });

    it('rePlan over a multi-night plan points each schedule-ended at the next night', async () => {
        const enabledRow = buildJoinedRow({ zone: { id: 'zone-multi', name: 'Multi Zone' } });
        const stub = createDaemonReposStub({ enabledZones: [enabledRow] });
        bootDaemonService({ repos: stub.repos, alertsDb: stub.alertsDb });
        const { clock, advanceTo } = createFakeClock(NOW);
        const { notifier, calls } = recordingNotifier();
        const tomorrowStart = new Date('2026-05-04T14:00:00Z');
        const tonight = buildEntry('2026-05-04', [{ startTime: '2026-05-04T13:00:00Z', durationMin: 4 }]);
        const tomorrow = buildEntry('2026-05-05', [{ startTime: tomorrowStart.toISOString(), durationMin: 4 }]);

        const control = await start({
            clock,
            rePlanHourLocal: 4,
            siteTimezone: 'UTC',
            notifier,
            runPlan: async () => ({ entries: [tonight, tomorrow], projectedNextDepletionMm: 0 }),
            openZone: async () => {},
            closeZone: async () => {},
        });

        await control.rePlan();
        await advanceTo(new Date('2026-05-04T14:04:30.000Z'));

        const begun = calls.filter(c => c.event === 'schedule-begun');
        const ended = calls.filter(c => c.event === 'schedule-ended');
        expect(begun.map(c => c.context?.scheduleNight)).toEqual(['2026-05-04', '2026-05-05']);
        expect(ended[0]?.context).toMatchObject({
            scheduleNight: '2026-05-04',
            nextIrrigation: { zoneName: 'Multi Zone', startTime: tomorrowStart },
        });
        expect(ended[1]?.context).toMatchObject({ scheduleNight: '2026-05-05' });
        expect(ended[1]?.context).not.toHaveProperty('nextIrrigation');
    });

    describe('cross-zone deconfliction', () => {
        type RunPlanCall = {
            zoneId: string;
            busyWindows: ReadonlyArray<{ start: Date; end: Date }>;
        };

        it(`passes the first zone's persisted cycle as a busy window to the second zone's planner`, async () => {
            const enabledRows = [
                buildJoinedRow({ zone: { id: 'zone-A', name: 'Zone A' } }),
                buildJoinedRow({ zone: { id: 'zone-B', name: 'Zone B' } }),
            ];
            const stub = createDaemonReposStub({ enabledZones: enabledRows });
            bootDaemonService({ repos: stub.repos, alertsDb: stub.alertsDb });
            const { clock } = createFakeClock(NOW);
            const calls: RunPlanCall[] = [];
            const zoneAEntry = buildEntry('2026-05-04', [{ startTime: '2026-05-04T05:00:00Z', durationMin: 30 }]);
            const zoneBEntry = buildEntry('2026-05-04', [{ startTime: '2026-05-04T05:10:00Z', durationMin: 30 }]);

            const control = await start({
                clock,
                rePlanHourLocal: 4,
                runPlan: async (zone, opts) => {
                    calls.push({ zoneId: zone.id, busyWindows: [...(opts?.busyWindows ?? [])] });
                    return zone.id === 'zone-A'
                        ? { entries: [zoneAEntry], projectedNextDepletionMm: 0 }
                        : { entries: [zoneBEntry], projectedNextDepletionMm: 0 };
                },
                getZoneState: async () => 'off',
                openZone: async () => {},
                closeZone: async () => {},
            });

            await control.rePlan();

            expect(calls).toHaveLength(2);
            expect(calls[0]?.zoneId).toBe('zone-A');
            const zoneAWindows = calls[0]!.busyWindows.filter(w => w.start.getTime() > 0);
            expect(zoneAWindows).toHaveLength(0);

            expect(calls[1]?.zoneId).toBe('zone-B');
            const zoneBCrossWindows = calls[1]!.busyWindows.filter(w => w.start.getTime() > 0);
            expect(zoneBCrossWindows).toHaveLength(1);
            const zoneABusy = zoneBCrossWindows[0]!;
            expect(zoneABusy.start.toISOString()).toBe('2026-05-04T05:00:00.000Z');
            expect(zoneABusy.end.toISOString()).toBe('2026-05-04T05:30:00.000Z');
        });

        it('accumulates busy windows across three zones in iteration order', async () => {
            const enabledRows = [
                buildJoinedRow({ zone: { id: 'zone-A' } }),
                buildJoinedRow({ zone: { id: 'zone-B' } }),
                buildJoinedRow({ zone: { id: 'zone-C' } }),
            ];
            const stub = createDaemonReposStub({ enabledZones: enabledRows });
            bootDaemonService({ repos: stub.repos, alertsDb: stub.alertsDb });
            const { clock } = createFakeClock(NOW);
            const calls: RunPlanCall[] = [];
            const entryFor = (_zoneId: string, start: string, durationMin: number) =>
                buildEntry('2026-05-04', [{ startTime: start, durationMin }]);

            const control = await start({
                clock,
                rePlanHourLocal: 4,
                runPlan: async (zone, opts) => {
                    calls.push({ zoneId: zone.id, busyWindows: [...(opts?.busyWindows ?? [])] });
                    if (zone.id === 'zone-A') return { entries: [entryFor(zone.id, '2026-05-04T05:00:00Z', 20)], projectedNextDepletionMm: 0 };
                    if (zone.id === 'zone-B') return { entries: [entryFor(zone.id, '2026-05-04T05:30:00Z', 20)], projectedNextDepletionMm: 0 };
                    return { entries: [entryFor(zone.id, '2026-05-04T06:00:00Z', 20)], projectedNextDepletionMm: 0 };
                },
                getZoneState: async () => 'off',
                openZone: async () => {},
                closeZone: async () => {},
            });

            await control.rePlan();

            const crossZoneCounts = calls.map(c => c.busyWindows.filter(w => w.start.getTime() > 0).length);
            expect(crossZoneCounts).toEqual([0, 1, 2]);
            const zoneCBusy = calls[2]!.busyWindows.filter(w => w.start.getTime() > 0);
            expect(zoneCBusy[0]?.start.toISOString()).toBe('2026-05-04T05:00:00.000Z');
            expect(zoneCBusy[0]?.end.toISOString()).toBe('2026-05-04T05:20:00.000Z');
            expect(zoneCBusy[1]?.start.toISOString()).toBe('2026-05-04T05:30:00.000Z');
            expect(zoneCBusy[1]?.end.toISOString()).toBe('2026-05-04T05:50:00.000Z');
        });

        it(`omits a failed zone's windows from the busy set passed to subsequent zones`, async () => {
            const enabledRows = [
                buildJoinedRow({ zone: { id: 'zone-A' } }),
                buildJoinedRow({ zone: { id: 'zone-bad' } }),
                buildJoinedRow({ zone: { id: 'zone-C' } }),
            ];
            const stub = createDaemonReposStub({ enabledZones: enabledRows });
            bootDaemonService({ repos: stub.repos, alertsDb: stub.alertsDb });
            const { clock } = createFakeClock(NOW);
            const calls: RunPlanCall[] = [];

            const control = await start({
                clock,
                rePlanHourLocal: 4,
                runPlan: async (zone, opts) => {
                    calls.push({ zoneId: zone.id, busyWindows: [...(opts?.busyWindows ?? [])] });
                    if (zone.id === 'zone-bad') throw new Error('plan failed');
                    if (zone.id === 'zone-A') return {
                        entries: [buildEntry('2026-05-04', [{ startTime: '2026-05-04T05:00:00Z', durationMin: 25 }])],
                        projectedNextDepletionMm: 0,
                    };
                    return {
                        entries: [buildEntry('2026-05-04', [{ startTime: '2026-05-04T06:00:00Z', durationMin: 25 }])],
                        projectedNextDepletionMm: 0,
                    };
                },
                getZoneState: async () => 'off',
                openZone: async () => {},
                closeZone: async () => {},
            });

            await control.rePlan();

            expect(calls.map(c => c.zoneId)).toEqual(['zone-A', 'zone-bad', 'zone-C']);
            const zoneCCrossWindows = calls[2]!.busyWindows.filter(w => w.start.getTime() > 0);
            expect(zoneCCrossWindows).toHaveLength(1);
            expect(zoneCCrossWindows[0]?.start.toISOString()).toBe('2026-05-04T05:00:00.000Z');
        });

        it(`includes in-flight cycle windows in the initial busy set passed to each zone's planner`, async () => {
            const futureRow = buildFutureCycleRow({
                cycle: { id: 'cycle-inflight', startTime: new Date('2026-05-04T12:30:00.000Z'), durationMin: 60 },
                zone: { id: 'zone-inflight' },
            });
            const enabledRow = buildJoinedRow({ zone: { id: 'zone-plan', siteId: 'site-001' } });
            const stub = createDaemonReposStub({
                futureCycles: [futureRow],
                enabledZones: [enabledRow],
            });
            bootDaemonService({ repos: stub.repos, alertsDb: stub.alertsDb });
            const { clock, advanceTo } = createFakeClock(NOW);
            const busyWindowsReceived: Array<ReadonlyArray<{ start: Date; end: Date }>> = [];

            const control = await start({
                clock,
                rePlanHourLocal: 4,
                runPlan: async (_z, opts) => {
                    busyWindowsReceived.push([...(opts?.busyWindows ?? [])]);
                    return { entries: [], projectedNextDepletionMm: 0 };
                },
                openZone: async () => {},
                closeZone: async () => {},
                getZoneState: async () => 'off',
            });

            await advanceTo(new Date('2026-05-04T12:30:01.000Z'));
            await control.rePlan();

            expect(busyWindowsReceived).toHaveLength(1);
            const windows = busyWindowsReceived[0]!;
            expect(windows.length).toBeGreaterThanOrEqual(1);
            const inFlightWindow = windows.find(
                w => w.end.getTime() >= new Date('2026-05-04T13:29:00.000Z').getTime()
                  && w.end.getTime() <= new Date('2026-05-04T13:31:00.000Z').getTime()
            );
            expect(inFlightWindow).toBeDefined();
        });

        it('does not arm a cycle that overlaps an in-flight window', async () => {
            const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
            try {
                const futureRow = buildFutureCycleRow({
                    cycle: { id: 'cycle-inflight', startTime: new Date('2026-05-04T12:30:00.000Z'), durationMin: 60 },
                    zone: { id: 'zone-inflight' },
                });
                const enabledRow = buildJoinedRow({ zone: { id: 'zone-plan', siteId: 'site-001' } });
                const stub = createDaemonReposStub({
                    futureCycles: [futureRow],
                    enabledZones: [enabledRow],
                });
                bootDaemonService({ repos: stub.repos, alertsDb: stub.alertsDb });
                const { clock, advanceTo } = createFakeClock(NOW);
                const opens: string[] = [];

                const control = await start({
                    clock,
                    rePlanHourLocal: 4,
                    runPlan: async () => ({
                        entries: [buildEntry('2026-05-04', [{ startTime: '2026-05-04T12:45:00Z', durationMin: 30 }])],
                        projectedNextDepletionMm: 0,
                    }),
                    openZone: async (z) => { opens.push(z.id); },
                    closeZone: async () => {},
                    getZoneState: async () => 'off',
                });

                await advanceTo(new Date('2026-05-04T12:30:01.000Z'));
                await control.rePlan();
                await advanceTo(new Date('2026-05-04T12:45:01.000Z'));

                expect(opens).toContain('zone-inflight');
                expect(opens).not.toContain('zone-plan');
                const warnMessages = warnSpy.mock.calls.map(args => String((args as unknown[])[0]));
                expect(warnMessages.some(m => m.includes('overlaps a busy window'))).toBe(true);
            } finally {
                warnSpy.mockRestore();
            }
        });

        it(`always includes a past-covering busy window (epoch → now) in the set passed to each zone's planner`, async () => {
            const enabledRow = buildJoinedRow({ zone: { id: 'zone-A' } });
            const stub = createDaemonReposStub({ enabledZones: [enabledRow] });
            bootDaemonService({ repos: stub.repos, alertsDb: stub.alertsDb });
            const { clock } = createFakeClock(NOW);
            let receivedBusyWindows: ReadonlyArray<{ start: Date; end: Date }> = [];

            const control = await start({
                clock,
                rePlanHourLocal: 4,
                runPlan: async (_z, opts) => {
                    receivedBusyWindows = [...(opts?.busyWindows ?? [])];
                    return { entries: [], projectedNextDepletionMm: 0 };
                },
                openZone: async () => {},
                closeZone: async () => {},
                getZoneState: async () => 'off',
            });

            await control.rePlan();

            const pastWindow = receivedBusyWindows.find(w => w.start.getTime() === 0);
            expect(pastWindow).toBeDefined();
            expect(pastWindow!.end.toISOString()).toBe(NOW.toISOString());
        });
    });

    describe('past-dated cycle rescheduling', () => {
        it(`persists planner output even when a returned cycle has a past start time — rescheduling is the planner's job`, async () => {
            const enabledRow = buildJoinedRow({ zone: { id: 'zone-loaded', name: 'Loaded Zone' } });
            const stub = createDaemonReposStub({ enabledZones: [enabledRow] });
            bootDaemonService({ repos: stub.repos, alertsDb: stub.alertsDb });
            const { clock } = createFakeClock(NOW);
            const pastEntry = buildEntry('2026-05-04', [{ startTime: '2026-05-04T10:00:00Z', durationMin: 30 }]);

            const control = await start({
                clock,
                rePlanHourLocal: 4,
                runPlan: async () => ({ entries: [pastEntry], projectedNextDepletionMm: 0 }),
                openZone: async () => {},
                closeZone: async () => {},
            });

            await control.rePlan();

            expect(stub.inserts.filter(c => c.table === scheduleEntries)).toHaveLength(1);
            expect(stub.inserts.filter(c => c.table === irrigationCycles)).toHaveLength(1);
        });

        it('does not open a zone when the planner returns no entries (all slots past)', async () => {
            const enabledRow = buildJoinedRow({ zone: { id: 'zone-loaded' } });
            const stub = createDaemonReposStub({ enabledZones: [enabledRow] });
            bootDaemonService({ repos: stub.repos, alertsDb: stub.alertsDb });
            const { clock, advanceTo } = createFakeClock(NOW);
            const opens: string[] = [];

            const control = await start({
                clock,
                rePlanHourLocal: 4,
                runPlan: async () => ({ entries: [], projectedNextDepletionMm: 0 }),
                openZone: async (z) => { opens.push(z.id); },
                closeZone: async () => {},
            });

            await control.rePlan();
            await advanceTo(new Date('2026-05-04T20:00:00.000Z'));

            expect(opens).toHaveLength(0);
        });
    });

    describe('schedule integration', () => {
        it(`forwards the active schedule's rootDepthMOverride and allowableDepletionFractionOverride to runPlan`, async () => {
            const enabledRow = buildJoinedRow({ zone: { id: 'zone-o', siteId: 'site-O' } });
            const stub = createDaemonReposStub({
                enabledZones: [enabledRow],
                activeSchedules: [{
                    schedule: {
                        id: 'sched-o', siteId: 'site-O', slug: 'overseeding', name: 'Overseeding',
                        isActive: true, allowedDays: null, allowedTimeWindows: null,
                        rootDepthMOverride: 0.05, allowableDepletionFractionOverride: 0.25,
                        endBySunrise: null, createdAt: NOW, updatedAt: NOW,
                    },
                }],
            });
            bootDaemonService({ repos: stub.repos, alertsDb: stub.alertsDb });
            const { clock } = createFakeClock(NOW);
            const planCalls: Array<{ rootDepthM: number | undefined; allowableDepletionFraction: number | undefined }> = [];

            const control = await start({
                clock,
                rePlanHourLocal: 4,
                runPlan: async (_z, opts) => {
                    planCalls.push({
                        rootDepthM: opts?.overrides?.rootDepthM,
                        allowableDepletionFraction: opts?.overrides?.allowableDepletionFraction,
                    });
                    return { entries: [], projectedNextDepletionMm: 0 };
                },
                openZone: async () => {},
                closeZone: async () => {},
                getZoneState: async () => 'off',
            });

            await control.rePlan();

            expect(planCalls).toHaveLength(1);
            expect(planCalls[0]?.rootDepthM).toBe(0.05);
            expect(planCalls[0]?.allowableDepletionFraction).toBe(0.25);
        });

        it('forwards undefined overrides when the active schedule has both override columns null', async () => {
            const enabledRow = buildJoinedRow({ zone: { id: 'zone-n', siteId: 'site-N' } });
            const stub = createDaemonReposStub({
                enabledZones: [enabledRow],
                activeSchedules: [{
                    schedule: {
                        id: 'sched-n', siteId: 'site-N', slug: 'maintenance', name: 'Maintenance',
                        isActive: true, allowedDays: null, allowedTimeWindows: null,
                        rootDepthMOverride: null, allowableDepletionFractionOverride: null,
                        endBySunrise: null, createdAt: NOW, updatedAt: NOW,
                    },
                }],
            });
            bootDaemonService({ repos: stub.repos, alertsDb: stub.alertsDb });
            const { clock } = createFakeClock(NOW);
            const planCalls: Array<{ rootDepthM: number | undefined; allowableDepletionFraction: number | undefined }> = [];

            const control = await start({
                clock,
                rePlanHourLocal: 4,
                runPlan: async (_z, opts) => {
                    planCalls.push({
                        rootDepthM: opts?.overrides?.rootDepthM,
                        allowableDepletionFraction: opts?.overrides?.allowableDepletionFraction,
                    });
                    return { entries: [], projectedNextDepletionMm: 0 };
                },
                openZone: async () => {},
                closeZone: async () => {},
                getZoneState: async () => 'off',
            });

            await control.rePlan();

            expect(planCalls).toHaveLength(1);
            expect(planCalls[0]?.rootDepthM).toBeUndefined();
            expect(planCalls[0]?.allowableDepletionFraction).toBeUndefined();
        });

        it(`forwards the active schedule's allowedDays and allowedTimeWindows to runPlan`, async () => {
            const enabledRow = buildJoinedRow({ zone: { id: 'zone-r', siteId: 'site-R' } });
            const stub = createDaemonReposStub({
                enabledZones: [enabledRow],
                activeSchedules: [{
                    schedule: {
                        id: 'sched-r', siteId: 'site-R', slug: 'maintenance', name: 'Maintenance',
                        isActive: true,
                        allowedDays: [3, 5, 7],
                        allowedTimeWindows: [
                            { start: '00:00', end: '10:00' },
                            { start: '19:00', end: '23:59' },
                        ],
                        rootDepthMOverride: null, allowableDepletionFractionOverride: null,
                        endBySunrise: null, createdAt: NOW, updatedAt: NOW,
                    },
                }],
            });
            bootDaemonService({ repos: stub.repos, alertsDb: stub.alertsDb });
            const { clock } = createFakeClock(NOW);
            const planCalls: Array<{ allowedDays: number[] | null | undefined; allowedTimeWindows: unknown; endBySunrise: unknown }> = [];

            const control = await start({
                clock,
                rePlanHourLocal: 4,
                runPlan: async (_z, opts) => {
                    planCalls.push({
                        allowedDays: opts?.restrictions?.allowedDays,
                        allowedTimeWindows: opts?.restrictions?.allowedTimeWindows,
                        endBySunrise: opts?.restrictions?.endBySunrise,
                    });
                    return { entries: [], projectedNextDepletionMm: 0 };
                },
                openZone: async () => {},
                closeZone: async () => {},
                getZoneState: async () => 'off',
            });

            await control.rePlan();

            expect(planCalls).toHaveLength(1);
            expect(planCalls[0]?.allowedDays).toEqual([3, 5, 7]);
            expect(planCalls[0]?.allowedTimeWindows).toEqual([
                { start: '00:00', end: '10:00' },
                { start: '19:00', end: '23:59' },
            ]);
            expect(planCalls[0]?.endBySunrise).toBe(false);
        });

        it('forwards endBySunrise: true from the active schedule to runPlan', async () => {
            const enabledRow = buildJoinedRow({ zone: { id: 'zone-ebs', siteId: 'site-EBS' } });
            const stub = createDaemonReposStub({
                enabledZones: [enabledRow],
                activeSchedules: [{
                    schedule: {
                        id: 'sched-ebs', siteId: 'site-EBS', slug: 'maintenance', name: 'Maintenance',
                        isActive: true, allowedDays: null, allowedTimeWindows: null,
                        rootDepthMOverride: null, allowableDepletionFractionOverride: null,
                        endBySunrise: true, createdAt: NOW, updatedAt: NOW,
                    },
                }],
            });
            bootDaemonService({ repos: stub.repos, alertsDb: stub.alertsDb });
            const { clock } = createFakeClock(NOW);
            const planCalls: Array<{ endBySunrise: unknown }> = [];

            const control = await start({
                clock,
                rePlanHourLocal: 4,
                runPlan: async (_z, opts) => {
                    planCalls.push({ endBySunrise: opts?.restrictions?.endBySunrise });
                    return { entries: [], projectedNextDepletionMm: 0 };
                },
                openZone: async () => {},
                closeZone: async () => {},
                getZoneState: async () => 'off',
            });

            await control.rePlan();

            expect(planCalls).toHaveLength(1);
            expect(planCalls[0]?.endBySunrise).toBe(true);
        });

        it('stamps the active schedule id on each schedule_entries insert during rePlan', async () => {
            const enabledRow = buildJoinedRow({ zone: { id: 'zone-loaded', siteId: 'site-A' } });
            const stub = createDaemonReposStub({
                enabledZones: [enabledRow],
                activeSchedules: [{
                    schedule: {
                        id: 'sched-active', siteId: 'site-A', slug: 'maintenance', name: 'Maintenance',
                        isActive: true, allowedDays: null, allowedTimeWindows: null,
                        rootDepthMOverride: null, allowableDepletionFractionOverride: null,
                        endBySunrise: null, createdAt: NOW, updatedAt: NOW,
                    },
                }],
            });
            bootDaemonService({ repos: stub.repos, alertsDb: stub.alertsDb });
            const { clock } = createFakeClock(NOW);
            const planned = buildEntry('2026-05-04', [{ startTime: '2026-05-04T13:00:00Z', durationMin: 20 }]);

            const control = await start({
                clock,
                rePlanHourLocal: 4,
                runPlan: async () => ({ entries: [planned], projectedNextDepletionMm: 0 }),
                openZone: async () => {},
                closeZone: async () => {},
                getZoneState: async () => 'off',
            });

            await control.rePlan();

            const entryInserts = stub.inserts.filter(c => c.table === scheduleEntries);
            expect(entryInserts).toHaveLength(1);
            expect(entryInserts[0]?.rows[0]?.['scheduleId']).toBe('sched-active');
        });

        it('skips a zone whose site has no active schedule and logs a warning', async () => {
            const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
            try {
                const enabledRow = buildJoinedRow({ zone: { id: 'zone-orphan', siteId: 'site-no-schedule' } });
                const stub = createDaemonReposStub({
                    enabledZones: [enabledRow],
                    activeSchedules: [],
                });
                bootDaemonService({ repos: stub.repos, alertsDb: stub.alertsDb });
                const { clock } = createFakeClock(NOW);
                const planCalls: string[] = [];

                const control = await start({
                    clock,
                    rePlanHourLocal: 4,
                    runPlan: async (z) => {
                        planCalls.push(z.id);
                        return { entries: [], projectedNextDepletionMm: 0 };
                    },
                    openZone: async () => {},
                    closeZone: async () => {},
                    getZoneState: async () => 'off',
                });

                await control.rePlan();

                expect(planCalls).toEqual([]);
                expect(stub.inserts.filter(c => c.table === scheduleEntries)).toHaveLength(0);
                const messages = warnSpy.mock.calls.map(args => String((args as unknown[])[0]));
                expect(messages.some(m => m.includes('no active schedule for site site-no-schedule'))).toBe(true);
            } finally {
                warnSpy.mockRestore();
            }
        });

        it('plans the zones whose sites have an active schedule even when other zones are skipped', async () => {
            const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
            try {
                const planned = buildJoinedRow({ zone: { id: 'zone-planned', siteId: 'site-active' } });
                const skipped = buildJoinedRow({ zone: { id: 'zone-skipped', siteId: 'site-empty' } });
                const stub = createDaemonReposStub({
                    enabledZones: [skipped, planned],
                    activeSchedules: [{
                        schedule: {
                            id: 'sched-A', siteId: 'site-active', slug: 'maintenance', name: 'Maintenance',
                            isActive: true, allowedDays: null, allowedTimeWindows: null,
                            rootDepthMOverride: null, allowableDepletionFractionOverride: null,
                            endBySunrise: null, createdAt: NOW, updatedAt: NOW,
                        },
                    }],
                });
                bootDaemonService({ repos: stub.repos, alertsDb: stub.alertsDb });
                const { clock } = createFakeClock(NOW);
                const planCalls: string[] = [];
                const entry = buildEntry('2026-05-04', [{ startTime: '2026-05-04T13:00:00Z', durationMin: 10 }]);

                const control = await start({
                    clock,
                    rePlanHourLocal: 4,
                    runPlan: async (z) => {
                        planCalls.push(z.id);
                        return { entries: [entry], projectedNextDepletionMm: 0 };
                    },
                    openZone: async () => {},
                    closeZone: async () => {},
                    getZoneState: async () => 'off',
                });

                await control.rePlan();

                expect(planCalls).toEqual(['zone-planned']);
                const entryInserts = stub.inserts.filter(c => c.table === scheduleEntries);
                expect(entryInserts).toHaveLength(1);
                expect(entryInserts[0]?.rows[0]?.['scheduleId']).toBe('sched-A');
            } finally {
                warnSpy.mockRestore();
            }
        });

        it(`forwards the active schedule's skippedNightDate to runPlan restrictions`, async () => {
            const enabledRow = buildJoinedRow({ zone: { id: 'zone-skip', siteId: 'site-Skip' } });
            const stub = createDaemonReposStub({
                enabledZones: [enabledRow],
                activeSchedules: [{
                    schedule: {
                        id: 'sched-skip', siteId: 'site-Skip', slug: 'maintenance', name: 'Maintenance',
                        isActive: true, allowedDays: null, allowedTimeWindows: null,
                        rootDepthMOverride: null, allowableDepletionFractionOverride: null,
                        endBySunrise: null, skippedNightDate: '2099-05-04',
                        createdAt: NOW, updatedAt: NOW,
                    },
                }],
            });
            bootDaemonService({ repos: stub.repos, alertsDb: stub.alertsDb });
            const { clock } = createFakeClock(NOW);
            const planCalls: Array<{ skippedNightDate: unknown }> = [];

            const control = await start({
                clock,
                rePlanHourLocal: 4,
                runPlan: async (_z, opts) => {
                    planCalls.push({ skippedNightDate: opts?.restrictions?.skippedNightDate });
                    return { entries: [], projectedNextDepletionMm: 0 };
                },
                openZone: async () => {},
                closeZone: async () => {},
                getZoneState: async () => 'off',
            });

            await control.rePlan();

            expect(planCalls).toHaveLength(1);
            expect(planCalls[0]?.skippedNightDate).toBe('2099-05-04');
        });

        it('forwards skippedNightDate: null when the active schedule has no marker', async () => {
            const enabledRow = buildJoinedRow({ zone: { id: 'zone-clean', siteId: 'site-Clean' } });
            const stub = createDaemonReposStub({
                enabledZones: [enabledRow],
                activeSchedules: [{
                    schedule: {
                        id: 'sched-clean', siteId: 'site-Clean', slug: 'maintenance', name: 'Maintenance',
                        isActive: true, allowedDays: null, allowedTimeWindows: null,
                        rootDepthMOverride: null, allowableDepletionFractionOverride: null,
                        endBySunrise: null, skippedNightDate: null,
                        createdAt: NOW, updatedAt: NOW,
                    },
                }],
            });
            bootDaemonService({ repos: stub.repos, alertsDb: stub.alertsDb });
            const { clock } = createFakeClock(NOW);
            const planCalls: Array<{ skippedNightDate: unknown }> = [];

            const control = await start({
                clock,
                rePlanHourLocal: 4,
                runPlan: async (_z, opts) => {
                    planCalls.push({ skippedNightDate: opts?.restrictions?.skippedNightDate });
                    return { entries: [], projectedNextDepletionMm: 0 };
                },
                openZone: async () => {},
                closeZone: async () => {},
                getZoneState: async () => 'off',
            });

            await control.rePlan();

            expect(planCalls).toHaveLength(1);
            expect(planCalls[0]?.skippedNightDate).toBeNull();
        });

        it('issues a clearStaleSkipMarkers update before reading active schedules', async () => {
            const enabledRow = buildJoinedRow({ zone: { id: 'zone-order', siteId: 'site-001' } });
            const stub = createDaemonReposStub({ enabledZones: [enabledRow] });
            bootDaemonService({ repos: stub.repos, alertsDb: stub.alertsDb });
            const { clock } = createFakeClock(NOW);

            const control = await start({
                clock,
                rePlanHourLocal: 4,
                runPlan: async () => ({ entries: [], projectedNextDepletionMm: 0 }),
                openZone: async () => {},
                closeZone: async () => {},
                getZoneState: async () => 'off',
            });

            await control.rePlan();

            expect(stub.schedulesTableUpdates.length).toBeGreaterThanOrEqual(1);
            expect(stub.schedulesTableUpdates[0]?.set).toEqual({ skippedNightDate: null });
            const ordering = stub.getOrdering();
            expect(ordering.clearStale).not.toBeNull();
            expect(ordering.activeScheduleRead).not.toBeNull();
            expect(ordering.clearStale!).toBeLessThan(ordering.activeScheduleRead!);
        });
    });

    describe('master kill switch', () => {
        it('does NOT arm future cycles at boot when the system is disabled, but still runs reconcile', async () => {
            const futureRow = buildFutureCycleRow({
                cycle: { id: 'cycle-future-disabled', startTime: new Date('2026-05-04T13:00:00.000Z'), durationMin: 10 },
            });
            const inFlightRow = buildFutureCycleRow({
                cycle: { id: 'cycle-inflight', startTime: new Date('2026-05-04T11:00:00.000Z'), durationMin: 90 },
                zone: { id: 'zone-inflight' },
            });
            const stub = createDaemonReposStub({
                futureCycles: [futureRow],
                inFlightCycles: [inFlightRow],
            });
            bootDaemonService({ repos: stub.repos, alertsDb: stub.alertsDb });
            bootSystemService({
                repo: {
                    findSingleton: async () => ({ irrigationEnabled: false, since: new Date('2026-05-04T08:00:00.000Z') }),
                    upsertSingleton: async () => {},
                },
            });
            const { clock, advanceTo, getPendingCount } = createFakeClock(NOW);
            const opens: string[] = [];
            const stateQueries: string[] = [];

            await start({
                clock,
                rePlanHourLocal: 4,
                runPlan: async () => ({ entries: [], projectedNextDepletionMm: 0 }),
                openZone: async (z) => { opens.push(z.id); },
                closeZone: async () => {},
                getZoneState: async (z) => {
                    stateQueries.push(z.id);
                    return 'off';
                },
            });

            expect(stateQueries).toContain('zone-inflight');

            const pendingBefore = getPendingCount();
            await advanceTo(new Date('2026-05-04T14:00:00.000Z'));
            expect(opens).toEqual([]);

            expect(pendingBefore).toBeLessThanOrEqual(1);
        });

        it('rePlan() skips planning when the system is disabled but still advances lastRePlanAt', async () => {
            const enabledRow = buildJoinedRow({ zone: { id: 'zone-disabled', siteId: 'site-001' } });
            const stub = createDaemonReposStub({ enabledZones: [enabledRow] });
            bootDaemonService({ repos: stub.repos, alertsDb: stub.alertsDb });
            bootSystemService({
                repo: {
                    findSingleton: async () => ({ irrigationEnabled: false, since: new Date('2026-05-04T08:00:00.000Z') }),
                    upsertSingleton: async () => {},
                },
            });
            const { clock } = createFakeClock(NOW);
            const planCalls: string[] = [];

            const control = await start({
                clock,
                rePlanHourLocal: 4,
                runPlan: async (z) => {
                    planCalls.push(z.id);
                    return { entries: [], projectedNextDepletionMm: 0 };
                },
                openZone: async () => {},
                closeZone: async () => {},
                getZoneState: async () => 'off',
            });

            await control.rePlan();

            expect(planCalls).toEqual([]);
            expect(stub.inserts.filter(c => c.table === scheduleEntries)).toHaveLength(0);
            expect(control.getStatus().lastRePlanAt).toBe(NOW.toISOString());
        });

        it('rePlan() with system enabled runs the planner normally (regression)', async () => {
            const enabledRow = buildJoinedRow({ zone: { id: 'zone-enabled', siteId: 'site-001' } });
            const stub = createDaemonReposStub({ enabledZones: [enabledRow] });
            bootDaemonService({ repos: stub.repos, alertsDb: stub.alertsDb });
            bootSystemService({
                repo: {
                    findSingleton: async () => ({ irrigationEnabled: true, since: new Date('2026-05-04T08:00:00.000Z') }),
                    upsertSingleton: async () => {},
                },
            });
            const { clock } = createFakeClock(NOW);
            const planCalls: string[] = [];

            const control = await start({
                clock,
                rePlanHourLocal: 4,
                runPlan: async (z) => {
                    planCalls.push(z.id);
                    return { entries: [], projectedNextDepletionMm: 0 };
                },
                openZone: async () => {},
                closeZone: async () => {},
                getZoneState: async () => 'off',
            });

            await control.rePlan();

            expect(planCalls).toEqual(['zone-enabled']);
        });
    });

    describe('startup reconciliation', () => {
        it('runs reconciliation before arming any future cycles from the boot loop', async () => {
            const futureRow = buildFutureCycleRow({
                cycle: { id: 'cycle-future', startTime: new Date('2026-05-04T13:00:00.000Z'), durationMin: 10 },
            });
            const inFlightRow = buildFutureCycleRow({
                cycle: { id: 'cycle-inflight', startTime: new Date('2026-05-04T11:00:00.000Z'), durationMin: 90 },
                zone: { id: 'zone-inflight' },
            });
            const stub = createDaemonReposStub({ futureCycles: [futureRow], inFlightCycles: [inFlightRow] });
            bootDaemonService({ repos: stub.repos, alertsDb: stub.alertsDb });
            const { clock } = createFakeClock(NOW);
            const events: string[] = [];

            await start({
                clock,
                rePlanHourLocal: 4,
                runPlan: async () => ({ entries: [], projectedNextDepletionMm: 0 }),
                openZone: async () => {},
                closeZone: async (z) => { events.push(`close:${z.id}`); },
                getZoneState: async (z) => {
                    events.push(`state:${z.id}`);
                    return 'off';
                },
            });

            expect(events[0]).toBe('state:zone-inflight');
        });

        it('logs the reconcile summary line at startup', async () => {
            const inFlightRow = buildFutureCycleRow({
                cycle: { id: 'cycle-running', startTime: new Date('2026-05-04T11:00:00.000Z'), durationMin: 30 },
                zone: { id: 'zone-running' },
            });
            const stub = createDaemonReposStub({ inFlightCycles: [inFlightRow] });
            bootDaemonService({ repos: stub.repos, alertsDb: stub.alertsDb });
            const { clock } = createFakeClock(NOW);
            const logSpy = spyOn(console, 'log').mockImplementation(() => {});

            try {
                await start({
                    clock,
                    rePlanHourLocal: 4,
                    runPlan: async () => ({ entries: [], projectedNextDepletionMm: 0 }),
                    openZone: async () => {},
                    closeZone: async () => {},
                    getZoneState: async () => 'off',
                });

                const messages = logSpy.mock.calls.map(args => String((args as unknown[])[0]));
                expect(messages.some(m => m.startsWith('daemon: reconcile summary'))).toBe(true);
            } finally {
                logSpy.mockRestore();
            }
        });

        it('propagates a hard reconcile failure (loadInFlightCycles throws) so start() rejects', async () => {
            const stub = createDaemonReposStub({ inFlightCyclesError: new Error('db down') });
            bootDaemonService({ repos: stub.repos, alertsDb: stub.alertsDb });
            const { clock } = createFakeClock(NOW);

            await expect(start({
                clock,
                rePlanHourLocal: 4,
                runPlan: async () => ({ entries: [], projectedNextDepletionMm: 0 }),
                openZone: async () => {},
                closeZone: async () => {},
                getZoneState: async () => 'off',
            })).rejects.toThrow('db down');
        });
    });

    describe('startup zone warnings', () => {
        let warnSpy: ReturnType<typeof spyOn>;

        beforeEach(() => {
            warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
        });

        afterEach(() => {
            warnSpy.mockRestore();
        });

        it('warns about an empty zones table when total is zero', async () => {
            const stub = createDaemonReposStub({ zoneCounts: { total: 0, enabled: 0 } });
            bootDaemonService({ repos: stub.repos, alertsDb: stub.alertsDb });
            const { clock } = createFakeClock(NOW);

            await start({ clock, rePlanHourLocal: 4 });

            const messages = warnSpy.mock.calls.map((args: unknown[]) => String(args[0]));
            expect(messages.some((m: string) => m.includes('has no zones to manage') && m.includes('bun run seed'))).toBe(true);
        });

        it('warns that all zones are disabled when total > 0 but enabled is zero', async () => {
            const stub = createDaemonReposStub({ zoneCounts: { total: 4, enabled: 0 } });
            bootDaemonService({ repos: stub.repos, alertsDb: stub.alertsDb });
            const { clock } = createFakeClock(NOW);

            await start({ clock, rePlanHourLocal: 4 });

            const messages = warnSpy.mock.calls.map((args: unknown[]) => String(args[0]));
            expect(messages.some((m: string) => m.includes('all zones are disabled'))).toBe(true);
            expect(messages.some((m: string) => m.includes('has no zones to manage'))).toBe(false);
        });

        it('emits no startup warning when at least one zone is enabled', async () => {
            const stub = createDaemonReposStub({ zoneCounts: { total: 4, enabled: 2 } });
            bootDaemonService({ repos: stub.repos, alertsDb: stub.alertsDb });
            const { clock } = createFakeClock(NOW);

            await start({ clock, rePlanHourLocal: 4 });

            expect(warnSpy).not.toHaveBeenCalled();
        });
    });
});

// Keep Drizzle table imports alive even if tree-shaken (used for table identity checks).
void grassTypes; void soilTypes; void sites; void zones; void schedules; void weatherState;
