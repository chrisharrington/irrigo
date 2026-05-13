import { afterEach, beforeEach, describe, it, expect, spyOn } from 'bun:test';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import {
    grassTypes,
    irrigationCycles,
    scheduleEntries,
    sites,
    soilTypes,
    zones,
} from '@/db/schema';

dayjs.extend(utc);
dayjs.extend(timezone);
import type { IrrigationScheduleEntry, Zone } from '@/models';
import { computeNextRePlanAt, start, type DaemonDb } from '.';
import {
    countZones,
    loadEnabledZones,
    loadZoneById,
    mapJoinedRowsToZones,
    type SelectJoinChain,
    type ZoneCountDb,
    type ZoneJoinedRow,
    type ZoneLoaderDb,
} from './zones';
import { loadSiteTimezone, type SiteTimezoneDb } from './sites';
import { noopNotifier, type NotificationContext, type NotificationEvent, type Notifier } from '@/notifications';

type RecordedNotification = { event: NotificationEvent; context: NotificationContext | undefined };

function recordingNotifier(): { notifier: Notifier; calls: RecordedNotification[] } {
    const calls: RecordedNotification[] = [];
    const notifier: Notifier = async (event, context) => {
        calls.push({ event, context });
    };
    return { notifier, calls };
}
import {
    loadFutureCycles,
    loadInFlightCycles,
    replaceZoneSchedule,
    type FutureCycleJoinedRow,
    type FutureCyclesDb,
    type PersistedCycle,
    type ScheduleWriterDb,
} from './schedules';
import {
    armCloseOnly,
    armCycle,
    closeAllInFlight,
    TimerRegistry,
    type Clock,
    type RuntimeDb,
    type TimerHandle,
} from './runtime';

const NOW = new Date('2026-05-04T12:00:00.000Z');

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

type WhereCall = { conditions: unknown };

function buildJoinChainStub<TRow>(whereCalls: WhereCall[], rows: TRow[]): SelectJoinChain<TRow> {
    const chain: SelectJoinChain<TRow> = {
        innerJoin: () => chain,
        where: (conditions) => {
            whereCalls.push({ conditions });
            return Promise.resolve(rows);
        },
    };
    return chain;
}

function createZoneLoaderStub(rows: ZoneJoinedRow[]) {
    const whereCalls: WhereCall[] = [];
    let selectColumns: unknown;

    const db: ZoneLoaderDb = {
        select(columns) {
            selectColumns = columns;
            return { from: () => buildJoinChainStub(whereCalls, rows) };
        },
    };

    return {
        db,
        whereCalls,
        getSelectColumns: () => selectColumns,
    };
}

function createZoneCountStub(rows: ReadonlyArray<{ total: number; enabled: number }>): ZoneCountDb {
    return {
        select() {
            return { from: () => Promise.resolve([...rows]) };
        },
    };
}

describe('countZones', () => {
    it('returns the total and enabled counts from the single returned row', async () => {
        const db = createZoneCountStub([{ total: 5, enabled: 3 }]);

        const result = await countZones(db);

        expect(result).toEqual({ total: 5, enabled: 3 });
    });

    it('defaults to zero counts when the query returns no rows', async () => {
        const db = createZoneCountStub([]);

        const result = await countZones(db);

        expect(result).toEqual({ total: 0, enabled: 0 });
    });
});

describe('mapJoinedRowsToZones', () => {
    it('drops zones whose is_enabled flag is false', () => {
        const enabled = buildJoinedRow({ zone: { id: 'enabled-zone', isEnabled: true } });
        const disabled = buildJoinedRow({ zone: { id: 'disabled-zone', isEnabled: false } });

        const result = mapJoinedRowsToZones([enabled, disabled]);

        expect(result).toHaveLength(1);
        expect(result[0]?.id).toBe('enabled-zone');
    });

    it('uses the zone-level latitude and longitude when both are set', () => {
        const row = buildJoinedRow({
            zone: { latitude: 49.5, longitude: -100.0 },
            site: { latitude: 51.05, longitude: -114.07 },
        });

        const result = mapJoinedRowsToZones([row]);

        expect(result[0]?.location).toEqual({ lat: 49.5, lon: -100.0 });
    });

    it('falls back to the site latitude and longitude when the zone has none', () => {
        const row = buildJoinedRow({
            zone: { latitude: null, longitude: null },
            site: { latitude: 51.05, longitude: -114.07 },
        });

        const result = mapJoinedRowsToZones([row]);

        expect(result[0]?.location).toEqual({ lat: 51.05, lon: -114.07 });
    });

    it('falls back per-axis when only one of the zone coordinates is null', () => {
        const row = buildJoinedRow({
            zone: { latitude: 49.5, longitude: null },
            site: { latitude: 51.05, longitude: -114.07 },
        });

        const result = mapJoinedRowsToZones([row]);

        expect(result[0]?.location).toEqual({ lat: 49.5, lon: -114.07 });
    });

    it('maps the grass type and soil type into the nested model shape', () => {
        const row = buildJoinedRow({
            grassType: { name: 'Bermudagrass', cropCoefficient: 0.65 },
            soilType: { name: 'Sandy Loam', availableWaterHoldingCapacityMmPerM: 125, infiltrationRateMmPerHr: 30 },
        });

        const result = mapJoinedRowsToZones([row]);

        expect(result[0]?.grassType).toEqual({ name: 'Bermudagrass', cropCoefficient: 0.65 });
        expect(result[0]?.soil).toEqual({ name: 'Sandy Loam', availableWaterHoldingCapacityMmPerM: 125, infiltrationRateMmPerHr: 30 });
    });

    it('converts null precipitationRateMmPerHr and homeAssistantEntityId to undefined', () => {
        const row = buildJoinedRow({
            zone: { precipitationRateMmPerHr: null, homeAssistantEntityId: null },
        });

        const result = mapJoinedRowsToZones([row]);

        expect(result[0]?.precipitationRateMmPerHr).toBeUndefined();
        expect(result[0]?.homeAssistantEntityId).toBeUndefined();
    });

    it('preserves non-null precipitationRateMmPerHr and homeAssistantEntityId', () => {
        const row = buildJoinedRow({
            zone: { precipitationRateMmPerHr: 12.5, homeAssistantEntityId: 'switch.front_yard' },
        });

        const result = mapJoinedRowsToZones([row]);

        expect(result[0]?.precipitationRateMmPerHr).toBe(12.5);
        expect(result[0]?.homeAssistantEntityId).toBe('switch.front_yard');
    });

    it('propagates the site timezone onto the zone model', () => {
        const row = buildJoinedRow({ site: { timezone: 'Europe/London' } });

        const result = mapJoinedRowsToZones([row]);

        expect(result[0]?.siteTimezone).toBe('Europe/London');
    });

    it('maps microclimateFactor from the zone row', () => {
        const row = buildJoinedRow({ zone: { microclimateFactor: 1.1 } });

        const result = mapJoinedRowsToZones([row]);

        expect(result[0]?.microclimateFactor).toBe(1.1);
    });
});

describe('loadEnabledZones', () => {
    it('returns mapped Zone models from the joined-row query', async () => {
        const row = buildJoinedRow({ zone: { id: 'returned-zone', name: 'Back Yard' } });
        const { db } = createZoneLoaderStub([row]);

        const result = await loadEnabledZones(db);

        expect(result).toHaveLength(1);
        expect(result[0]?.id).toBe('returned-zone');
        expect(result[0]?.name).toBe('Back Yard');
    });

    it('passes the standard set of joined columns to db.select', async () => {
        const { db, getSelectColumns } = createZoneLoaderStub([]);

        await loadEnabledZones(db);

        const cols = getSelectColumns() as Record<string, unknown>;
        expect(cols['zone']).toBe(zones);
        expect(cols['grassType']).toBe(grassTypes);
        expect(cols['soilType']).toBe(soilTypes);
        expect(cols['site']).toBe(sites);
    });

    it('issues exactly one .where(...) call per invocation', async () => {
        const { db, whereCalls } = createZoneLoaderStub([buildJoinedRow()]);

        await loadEnabledZones(db);

        expect(whereCalls).toHaveLength(1);
    });

    it('returns an empty array when no zones match', async () => {
        const { db } = createZoneLoaderStub([]);

        const result = await loadEnabledZones(db);

        expect(result).toEqual([]);
    });
});

describe('loadZoneById', () => {
    it('returns the mapped Zone when a row matches the id', async () => {
        const row = buildJoinedRow({ zone: { id: 'zone-target', name: 'Target Zone' } });
        const { db } = createZoneLoaderStub([row]);

        const result = await loadZoneById(db, 'zone-target');

        expect(result).not.toBeNull();
        expect(result?.id).toBe('zone-target');
        expect(result?.name).toBe('Target Zone');
    });

    it('returns null when no row matches the id', async () => {
        const { db } = createZoneLoaderStub([]);

        const result = await loadZoneById(db, 'zone-missing');

        expect(result).toBeNull();
    });
});

type DeleteCall = { table: unknown; conditions: unknown };
type InsertCall = { table: unknown; rows: ReadonlyArray<Record<string, unknown>> };
type UpdateCall = { table: unknown; values: Record<string, unknown>; conditions: unknown };

function createScheduleWriterStub(idPlan?: { entries?: string[]; cycles?: string[][] }) {
    const deleteCalls: DeleteCall[] = [];
    const insertCalls: InsertCall[] = [];
    const updateCalls: UpdateCall[] = [];
    let entryIdx = 0;
    let cycleBatchIdx = 0;

    const db: ScheduleWriterDb = {
        delete(table) {
            return {
                where(conditions) {
                    deleteCalls.push({ table, conditions });
                    return Promise.resolve(undefined);
                },
            };
        },
        insert(table) {
            return {
                values(rows) {
                    return {
                        returning() {
                            insertCalls.push({ table, rows });
                            if (table === scheduleEntries) {
                                const id = idPlan?.entries?.[entryIdx] ?? `entry-${entryIdx}`;
                                entryIdx += 1;
                                return Promise.resolve([{ id }]);
                            }
                            if (table === irrigationCycles) {
                                const ids = idPlan?.cycles?.[cycleBatchIdx] ?? rows.map((_, i) => `cycle-${cycleBatchIdx}-${i}`);
                                cycleBatchIdx += 1;
                                const out = rows.map((row, i) => ({
                                    id: ids[i],
                                    startTime: row['startTime'],
                                    durationMin: row['durationMin'],
                                }));
                                return Promise.resolve(out);
                            }
                            return Promise.resolve([]);
                        },
                    };
                },
            };
        },
        update(table) {
            return {
                set(values) {
                    return {
                        where(conditions) {
                            updateCalls.push({ table, values, conditions });
                            return Promise.resolve(undefined);
                        },
                    };
                },
            };
        },
    };

    return { db, deleteCalls, insertCalls, updateCalls };
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

describe('replaceZoneSchedule', () => {
    it('issues a delete on schedule_entries for the zone before any inserts', async () => {
        const { db, deleteCalls, insertCalls } = createScheduleWriterStub();
        const entry = buildEntry('2026-05-04', [{ startTime: '2026-05-04T05:00:00Z', durationMin: 20 }]);

        await replaceZoneSchedule(db, 'zone-001', [entry], '2026-05-04', 0, 'sched-default');

        expect(deleteCalls).toHaveLength(1);
        expect(deleteCalls[0]?.table).toBe(scheduleEntries);
        expect(insertCalls.length).toBeGreaterThan(0);
    });

    it('stamps the supplied scheduleId on each inserted schedule_entries row', async () => {
        const { db, insertCalls } = createScheduleWriterStub({ entries: ['entry-A', 'entry-B'] });
        const entries = [
            buildEntry('2026-05-04', [{ startTime: '2026-05-04T05:00:00Z', durationMin: 20 }]),
            buildEntry('2026-05-06', [{ startTime: '2026-05-06T05:00:00Z', durationMin: 25 }]),
        ];

        await replaceZoneSchedule(db, 'zone-001', entries, '2026-05-04', 0, 'sched-overseed');

        const entryInserts = insertCalls.filter(c => c.table === scheduleEntries);
        expect(entryInserts).toHaveLength(2);
        for (const call of entryInserts) {
            expect(call.rows[0]?.['scheduleId']).toBe('sched-overseed');
        }
    });

    it('inserts one schedule_entries row per planner entry with the right zoneId, date, and depletion fields', async () => {
        const { db, insertCalls } = createScheduleWriterStub({ entries: ['entry-A', 'entry-B'] });
        const entries = [
            buildEntry('2026-05-04', [{ startTime: '2026-05-04T05:00:00Z', durationMin: 20 }]),
            buildEntry('2026-05-06', [{ startTime: '2026-05-06T05:00:00Z', durationMin: 25 }]),
        ];

        await replaceZoneSchedule(db, 'zone-001', entries, '2026-05-04', 0, 'sched-default');

        const entryInserts = insertCalls.filter(c => c.table === scheduleEntries);
        expect(entryInserts).toHaveLength(2);
        expect(entryInserts[0]?.rows[0]).toMatchObject({
            zoneId: 'zone-001',
            date: '2026-05-04',
            appliedDepthMm: 12.0,
            depletionBeforeMm: 18.5,
            depletionAfterMm: 0,
        });
        expect(entryInserts[1]?.rows[0]).toMatchObject({ date: '2026-05-06' });
    });

    it('inserts the cycles for each entry referencing the inserted entry id', async () => {
        const { db, insertCalls } = createScheduleWriterStub({ entries: ['entry-A'] });
        const entry = buildEntry('2026-05-04', [
            { startTime: '2026-05-04T05:00:00Z', durationMin: 20 },
            { startTime: '2026-05-04T05:30:00Z', durationMin: 15 },
        ]);

        await replaceZoneSchedule(db, 'zone-001', [entry], '2026-05-04', 0, 'sched-default');

        const cycleInserts = insertCalls.filter(c => c.table === irrigationCycles);
        expect(cycleInserts).toHaveLength(1);
        expect(cycleInserts[0]?.rows).toHaveLength(2);
        expect(cycleInserts[0]?.rows[0]).toMatchObject({
            scheduleEntryId: 'entry-A',
            durationMin: 20,
        });
        expect(cycleInserts[0]?.rows[0]?.['startTime']).toBeInstanceOf(Date);
    });

    it('returns each inserted cycle with its generated id, start time, and duration', async () => {
        const { db } = createScheduleWriterStub({
            entries: ['entry-A'],
            cycles: [['cycle-A1', 'cycle-A2']],
        });
        const entry = buildEntry('2026-05-04', [
            { startTime: '2026-05-04T05:00:00Z', durationMin: 20 },
            { startTime: '2026-05-04T05:30:00Z', durationMin: 15 },
        ]);

        const result = await replaceZoneSchedule(db, 'zone-001', [entry], '2026-05-04', 0, 'sched-default');

        expect(result.cycles).toHaveLength(2);
        expect(result.cycles[0]?.id).toBe('cycle-A1');
        expect(result.cycles[0]?.durationMin).toBe(20);
        expect(result.cycles[1]?.id).toBe('cycle-A2');
        expect(result.cycles[1]?.durationMin).toBe(15);
    });

    it('still issues the delete and inserts no rows when given an empty entries array', async () => {
        const { db, deleteCalls, insertCalls } = createScheduleWriterStub();

        const result = await replaceZoneSchedule(db, 'zone-001', [], '2026-05-04', 0, 'sched-default');

        expect(deleteCalls).toHaveLength(1);
        expect(insertCalls).toHaveLength(0);
        expect(result.cycles).toEqual([]);
    });

    it('skips cycle inserts when the planner entry has no cycles for the day', async () => {
        const { db, insertCalls } = createScheduleWriterStub({ entries: ['entry-A'] });
        const entry = buildEntry('2026-05-04', []);

        const result = await replaceZoneSchedule(db, 'zone-001', [entry], '2026-05-04', 0, 'sched-default');

        expect(insertCalls.filter(c => c.table === scheduleEntries)).toHaveLength(1);
        expect(insertCalls.filter(c => c.table === irrigationCycles)).toHaveLength(0);
        expect(result.cycles).toEqual([]);
    });

    it('writes the projected next-day depletion to zones.current_depletion_mm', async () => {
        const { db, updateCalls } = createScheduleWriterStub();
        const entry = buildEntry('2026-05-04', [{ startTime: '2026-05-04T05:00:00Z', durationMin: 20 }]);

        await replaceZoneSchedule(db, 'zone-001', [entry], '2026-05-04', 7.5, 'sched-default');

        expect(updateCalls).toHaveLength(1);
        expect(updateCalls[0]?.table).toBe(zones);
        expect(updateCalls[0]?.values).toEqual({ currentDepletionMm: 7.5 });
    });

    it('writes the depletion update even when the entries array is empty', async () => {
        const { db, updateCalls } = createScheduleWriterStub();

        await replaceZoneSchedule(db, 'zone-002', [], '2026-05-04', 12.3, 'sched-default');

        expect(updateCalls).toHaveLength(1);
        expect(updateCalls[0]?.values).toEqual({ currentDepletionMm: 12.3 });
    });
});

const NOW_DAEMON = new Date('2026-05-04T12:00:00.000Z');

function buildFutureCycleRow(overrides?: Partial<{
    cycle: Partial<FutureCycleJoinedRow['cycle']>;
    scheduleEntry: Partial<FutureCycleJoinedRow['scheduleEntry']>;
    zone: Partial<FutureCycleJoinedRow['zone']>;
    site: Partial<FutureCycleJoinedRow['site']>;
}>): FutureCycleJoinedRow {
    const base = buildJoinedRow({ zone: overrides?.zone, site: overrides?.site });
    return {
        ...base,
        cycle: {
            id: 'cycle-001',
            scheduleEntryId: 'entry-001',
            startTime: new Date('2026-05-05T05:00:00.000Z'),
            durationMin: 25,
            firedAt: null,
            closedAt: null,
            createdAt: NOW_DAEMON,
            updatedAt: NOW_DAEMON,
            ...overrides?.cycle,
        },
        scheduleEntry: {
            id: 'entry-001',
            zoneId: base.zone.id,
            date: '2026-05-05',
            appliedDepthMm: 12,
            depletionBeforeMm: 18.5,
            depletionAfterMm: 0,
            createdAt: NOW_DAEMON,
            updatedAt: NOW_DAEMON,
            ...overrides?.scheduleEntry,
        },
    };
}

function createFutureCyclesStub(rows: FutureCycleJoinedRow[]) {
    const whereCalls: WhereCall[] = [];
    let selectColumns: unknown;

    const db: FutureCyclesDb = {
        select(columns) {
            selectColumns = columns;
            return { from: () => buildJoinChainStub(whereCalls, rows) };
        },
    };

    return { db, whereCalls, getSelectColumns: () => selectColumns };
}

describe('loadFutureCycles', () => {
    it('returns mapped (cycle, zone) pairs with the runtime fields the caller needs', async () => {
        const row = buildFutureCycleRow({
            cycle: { id: 'cycle-future', durationMin: 30 },
            zone: { id: 'zone-future', name: 'Future Zone' },
        });
        const { db } = createFutureCyclesStub([row]);

        const pairs = await loadFutureCycles(db, NOW_DAEMON);

        expect(pairs).toHaveLength(1);
        expect(pairs[0]?.cycle.id).toBe('cycle-future');
        expect(pairs[0]?.cycle.durationMin).toBe(30);
        expect(pairs[0]?.cycle.startTime).toBeInstanceOf(Date);
        expect(pairs[0]?.zone.id).toBe('zone-future');
        expect(pairs[0]?.zone.name).toBe('Future Zone');
    });

    it('builds the zone with site-fallback location when the zone has none', async () => {
        const row = buildFutureCycleRow({
            zone: { latitude: null, longitude: null },
            site: { latitude: 51.05, longitude: -114.07 },
        });
        const { db } = createFutureCyclesStub([row]);

        const pairs = await loadFutureCycles(db, NOW_DAEMON);

        expect(pairs[0]?.zone.location).toEqual({ lat: 51.05, lon: -114.07 });
    });

    it('passes the standard joined columns to db.select', async () => {
        const { db, getSelectColumns } = createFutureCyclesStub([]);

        await loadFutureCycles(db, NOW_DAEMON);

        const cols = getSelectColumns() as Record<string, unknown>;
        expect(cols['cycle']).toBe(irrigationCycles);
        expect(cols['scheduleEntry']).toBe(scheduleEntries);
        expect(cols['zone']).toBe(zones);
        expect(cols['grassType']).toBe(grassTypes);
        expect(cols['soilType']).toBe(soilTypes);
        expect(cols['site']).toBe(sites);
    });

    it('issues exactly one .where(...) call per invocation', async () => {
        const { db, whereCalls } = createFutureCyclesStub([buildFutureCycleRow()]);

        await loadFutureCycles(db, NOW_DAEMON);

        expect(whereCalls).toHaveLength(1);
    });

    it('returns an empty array when the query yields no rows', async () => {
        const { db } = createFutureCyclesStub([]);

        const result = await loadFutureCycles(db, NOW_DAEMON);

        expect(result).toEqual([]);
    });
});

describe('loadInFlightCycles', () => {
    it('returns mapped (cycle, zone) pairs for in-flight rows', async () => {
        const row = buildFutureCycleRow({
            cycle: { id: 'cycle-running', firedAt: new Date('2026-05-04T11:00:00.000Z'), closedAt: null },
            zone: { id: 'zone-running' },
        });
        const { db } = createFutureCyclesStub([row]);

        const pairs = await loadInFlightCycles(db, NOW_DAEMON);

        expect(pairs).toHaveLength(1);
        expect(pairs[0]?.cycle.id).toBe('cycle-running');
        expect(pairs[0]?.zone.id).toBe('zone-running');
    });

    it('returns an empty array when there are no in-flight rows', async () => {
        const { db } = createFutureCyclesStub([]);

        const result = await loadInFlightCycles(db, NOW_DAEMON);

        expect(result).toEqual([]);
    });

    it('issues exactly one .where(...) call per invocation', async () => {
        const { db, whereCalls } = createFutureCyclesStub([buildFutureCycleRow()]);

        await loadInFlightCycles(db, NOW_DAEMON);

        expect(whereCalls).toHaveLength(1);
    });
});

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
        // 2026-05-04T01:30Z = 2026-05-03T19:30 MDT (UTC-6 during DST). Next local 04:00 is 2026-05-04T04:00 MDT = 2026-05-04T10:00Z.
        const now = new Date('2026-05-04T01:30:00.000Z');
        const next = computeNextRePlanAt(now, 4, 'America/Edmonton');

        expect(next.toISOString()).toBe('2026-05-04T10:00:00.000Z');
    });

    it('Edmonton MDT: rolls to tomorrow when now is past local 04:00', () => {
        // 2026-05-04T18:30Z = 2026-05-04T12:30 MDT. Next local 04:00 is 2026-05-05T04:00 MDT = 2026-05-05T10:00Z.
        const now = new Date('2026-05-04T18:30:00.000Z');
        const next = computeNextRePlanAt(now, 4, 'America/Edmonton');

        expect(next.toISOString()).toBe('2026-05-05T10:00:00.000Z');
    });

    it('Edmonton MST: maps local 04:00 to the correct UTC instant outside DST', () => {
        // 2026-01-15T18:30Z = 2026-01-15T11:30 MST (UTC-7 outside DST). Next local 04:00 is 2026-01-16T04:00 MST = 2026-01-16T11:00Z.
        const now = new Date('2026-01-15T18:30:00.000Z');
        const next = computeNextRePlanAt(now, 4, 'America/Edmonton');

        expect(next.toISOString()).toBe('2026-01-16T11:00:00.000Z');
    });
});

describe('loadSiteTimezone', () => {
    function createSiteStub(rows: ReadonlyArray<{ timezone: string }>): SiteTimezoneDb {
        return {
            select() {
                return { from: () => Promise.resolve([...rows]) };
            },
        };
    }

    let warnSpy: ReturnType<typeof spyOn>;

    beforeEach(() => {
        warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        warnSpy.mockRestore();
    });

    it(`returns the single site's timezone without warning`, async () => {
        const db = createSiteStub([{ timezone: 'America/Edmonton' }]);

        const result = await loadSiteTimezone(db);

        expect(result).toBe('America/Edmonton');
        expect(warnSpy).not.toHaveBeenCalled();
    });

    it('returns UTC and warns when no sites exist', async () => {
        const db = createSiteStub([]);

        const result = await loadSiteTimezone(db);

        expect(result).toBe('UTC');
        expect(warnSpy).toHaveBeenCalledTimes(1);
        const message = String((warnSpy.mock.calls[0] as unknown[])[0] as string);
        expect(message).toContain('no sites found');
    });

    it(`picks the first row's timezone and warns when multiple sites exist`, async () => {
        const db = createSiteStub([
            { timezone: 'America/Edmonton' },
            { timezone: 'Europe/London' },
        ]);

        const result = await loadSiteTimezone(db);

        expect(result).toBe('America/Edmonton');
        expect(warnSpy).toHaveBeenCalledTimes(1);
        const message = String((warnSpy.mock.calls[0] as unknown[])[0] as string);
        expect(message).toContain('multiple sites');
    });
});

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
        // Repeatedly fire whichever timer is earliest among those due, until none remain.
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

type CycleUpdate = { cycleId: string; firedAt?: Date; closedAt?: Date };

function createRuntimeDbStub() {
    const updates: CycleUpdate[] = [];
    const db: RuntimeDb = {
        update(table) {
            expect(table).toBe(irrigationCycles);
            return {
                set(values) {
                    return {
                        async where(cond) {
                            // Inspect the cond to extract cycle id — for the fake we just
                            // record the values + a free-form id placeholder. Real Drizzle
                            // would compile this to a parameterized statement.
                            const update: CycleUpdate = { cycleId: extractCycleId(cond) };
                            if (values['firedAt'] instanceof Date) update.firedAt = values['firedAt'];
                            if (values['closedAt'] instanceof Date) update.closedAt = values['closedAt'];
                            updates.push(update);
                            return Promise.resolve(undefined);
                        },
                    };
                },
            };
        },
    };
    return { db, updates };
}

// Extracts the comparison value from an `eq(irrigationCycles.id, X)` condition. Drizzle's
// SQL object can contain cyclic references, so we walk it manually with a WeakSet rather
// than reaching for JSON.stringify.
function extractCycleId(cond: unknown): string {
    const seen = new WeakSet<object>();
    function walk(node: unknown): string | undefined {
        if (typeof node === 'string') return /^cycle-/.test(node) ? node : undefined;
        if (typeof node !== 'object' || node === null) return undefined;
        if (seen.has(node)) return undefined;
        seen.add(node);
        if (Array.isArray(node)) {
            for (const item of node) {
                const found = walk(item);
                if (found) return found;
            }
            return undefined;
        }
        for (const value of Object.values(node)) {
            const found = walk(value);
            if (found) return found;
        }
        return undefined;
    }
    return walk(cond) ?? '';
}

function buildPersistedCycle(overrides?: Partial<PersistedCycle>): PersistedCycle {
    return {
        id: 'cycle-001',
        startTime: new Date('2026-05-04T13:00:00.000Z'),
        durationMin: 20,
        ...overrides,
    };
}

function buildZoneModel(overrides?: Partial<Zone>): Zone {
    return {
        id: 'zone-001',
        name: 'Front Lawn',
        grassType: { name: 'Kentucky Bluegrass', cropCoefficient: 0.85 },
        soil: { name: 'Loam', availableWaterHoldingCapacityMmPerM: 150, infiltrationRateMmPerHr: 25 },
        rootDepthM: 0.3,
        allowableDepletionFraction: 0.5,
        irrigationEfficiency: 0.8,
        flowRateLPerMin: 15,
        areaM2: 100,
        precipitationRateMmPerHr: 9,
        currentDepletionMm: 0,
        siteId: 'site-A',
        siteTimezone: 'America/Edmonton',
        isEnabled: true,
        location: { lat: 51.0447, lon: -114.0719 },
        homeAssistantEntityId: 'switch.zone_1',
        ...overrides,
    };
}

describe('armCycle', () => {
    const NOW = new Date('2026-05-04T12:00:00.000Z');

    it('opens the zone at start_time, records firedAt, then closes after durationMin and records closedAt', async () => {
        const { clock, advanceTo } = createFakeClock(NOW);
        const { db, updates } = createRuntimeDbStub();
        const registry = new TimerRegistry();
        const zone = buildZoneModel({ id: 'zone-001' });
        const cycle = buildPersistedCycle({
            id: 'cycle-A',
            startTime: new Date('2026-05-04T13:00:00.000Z'),
            durationMin: 30,
        });
        const opens: Zone[] = [];
        const closes: Zone[] = [];
        const openZone = async (z: Zone) => { opens.push(z); };
        const closeZone = async (z: Zone) => { closes.push(z); };

        armCycle({ db, clock, registry, zone, cycle, openZone, closeZone, notifier: noopNotifier });

        await advanceTo(new Date('2026-05-04T13:30:01.000Z'));

        expect(opens).toHaveLength(1);
        expect(opens[0]?.id).toBe('zone-001');
        expect(closes).toHaveLength(1);
        expect(updates.map(u => ({ id: u.cycleId, fired: !!u.firedAt, closed: !!u.closedAt }))).toEqual([
            { id: 'cycle-A', fired: true, closed: false },
            { id: 'cycle-A', fired: false, closed: true },
        ]);
    });

    it('skips chaining the close when openZone fails and leaves firedAt unset', async () => {
        const { clock, advanceTo } = createFakeClock(NOW);
        const { db, updates } = createRuntimeDbStub();
        const registry = new TimerRegistry();
        const zone = buildZoneModel();
        const cycle = buildPersistedCycle({
            id: 'cycle-B',
            startTime: new Date('2026-05-04T13:00:00.000Z'),
            durationMin: 20,
        });
        const closes: Zone[] = [];
        const openZone = async () => { throw new Error('HA down'); };
        const closeZone = async (z: Zone) => { closes.push(z); };

        armCycle({ db, clock, registry, zone, cycle, openZone, closeZone, notifier: noopNotifier });
        await advanceTo(new Date('2026-05-04T13:30:00.000Z'));

        expect(closes).toEqual([]);
        expect(updates).toEqual([]);
        expect(registry.snapshotInFlight()).toEqual([]);
    });

    it('records firedAt but not closedAt when closeZone fails after a successful open', async () => {
        const { clock, advanceTo } = createFakeClock(NOW);
        const { db, updates } = createRuntimeDbStub();
        const registry = new TimerRegistry();
        const zone = buildZoneModel();
        const cycle = buildPersistedCycle({
            id: 'cycle-C',
            startTime: new Date('2026-05-04T13:00:00.000Z'),
            durationMin: 15,
        });
        const openZone = async () => { /* success */ };
        const closeZone = async () => { throw new Error('close failed'); };

        armCycle({ db, clock, registry, zone, cycle, openZone, closeZone, notifier: noopNotifier });
        await advanceTo(new Date('2026-05-04T13:30:00.000Z'));

        expect(updates).toHaveLength(1);
        expect(updates[0]?.firedAt).toBeInstanceOf(Date);
        expect(updates[0]?.closedAt).toBeUndefined();
        expect(registry.snapshotInFlight()).toEqual([]);
    });

    it('fires immediately if start_time is in the past relative to now', async () => {
        const { clock, advanceTo } = createFakeClock(NOW);
        const { db, updates } = createRuntimeDbStub();
        const registry = new TimerRegistry();
        const zone = buildZoneModel();
        const cycle = buildPersistedCycle({
            id: 'cycle-D',
            startTime: new Date('2026-05-04T11:00:00.000Z'),
            durationMin: 5,
        });
        const opens: Zone[] = [];
        const openZone = async (z: Zone) => { opens.push(z); };
        const closeZone = async () => { /* success */ };

        armCycle({ db, clock, registry, zone, cycle, openZone, closeZone, notifier: noopNotifier });
        await advanceTo(new Date('2026-05-04T12:05:01.000Z'));

        expect(opens).toHaveLength(1);
        expect(updates.length).toBeGreaterThanOrEqual(1);
    });

    it('notifies watering-started without a reason qualifier when armReason is omitted', async () => {
        const { clock, advanceTo } = createFakeClock(NOW);
        const { db } = createRuntimeDbStub();
        const registry = new TimerRegistry();
        const zone = buildZoneModel({ id: 'zone-001', name: 'Front Lawn' });
        const cycle = buildPersistedCycle({ id: 'cycle-N', startTime: new Date('2026-05-04T13:00:00.000Z'), durationMin: 12 });
        const { notifier, calls } = recordingNotifier();

        armCycle({ db, clock, registry, zone, cycle, openZone: async () => {}, closeZone: async () => {}, notifier });
        await advanceTo(new Date('2026-05-04T13:00:30.000Z'));

        const started = calls.find(c => c.event === 'watering-started');
        expect(started?.context).toEqual({ zoneName: 'Front Lawn', durationMin: 12 });
    });

    it('flags watering-started with reason=boot when armReason is boot', async () => {
        const { clock, advanceTo } = createFakeClock(NOW);
        const { db } = createRuntimeDbStub();
        const registry = new TimerRegistry();
        const zone = buildZoneModel({ id: 'zone-001', name: 'Front Lawn' });
        const cycle = buildPersistedCycle({ id: 'cycle-B', startTime: new Date('2026-05-04T11:00:00.000Z'), durationMin: 12 });
        const { notifier, calls } = recordingNotifier();

        armCycle({ db, clock, registry, zone, cycle, openZone: async () => {}, closeZone: async () => {}, notifier, armReason: 'boot' });
        await advanceTo(new Date('2026-05-04T12:00:30.000Z'));

        const started = calls.find(c => c.event === 'watering-started');
        expect(started?.context).toEqual({ zoneName: 'Front Lawn', durationMin: 12, reason: 'boot' });
    });

    it('emits an error notification when openZone fails', async () => {
        const { clock, advanceTo } = createFakeClock(NOW);
        const { db } = createRuntimeDbStub();
        const registry = new TimerRegistry();
        const zone = buildZoneModel({ id: 'zone-001', name: 'Front Lawn' });
        const cycle = buildPersistedCycle({ id: 'cycle-E', startTime: new Date('2026-05-04T13:00:00.000Z'), durationMin: 10 });
        const { notifier, calls } = recordingNotifier();

        armCycle({
            db, clock, registry, zone, cycle,
            openZone: async () => { throw new Error('HA 502'); },
            closeZone: async () => {},
            notifier,
        });
        await advanceTo(new Date('2026-05-04T13:00:30.000Z'));

        expect(calls.find(c => c.event === 'watering-started')).toBeUndefined();
        const errorCall = calls.find(c => c.event === 'error');
        expect(errorCall?.context).toEqual({ zoneName: 'Front Lawn', operation: 'open', reason: 'HA 502' });
    });

    it('notifies watering-ended without a reason when a cycle closes naturally', async () => {
        const { clock, advanceTo } = createFakeClock(NOW);
        const { db } = createRuntimeDbStub();
        const registry = new TimerRegistry();
        const zone = buildZoneModel({ id: 'zone-001', name: 'Front Lawn' });
        const cycle = buildPersistedCycle({ id: 'cycle-OK', startTime: new Date('2026-05-04T13:00:00.000Z'), durationMin: 5 });
        const { notifier, calls } = recordingNotifier();

        armCycle({ db, clock, registry, zone, cycle, openZone: async () => {}, closeZone: async () => {}, notifier });
        await advanceTo(new Date('2026-05-04T13:05:30.000Z'));

        const ended = calls.find(c => c.event === 'watering-ended');
        expect(ended?.context).toEqual({ zoneName: 'Front Lawn' });
    });

    it('emits an error notification when closeZone fails after a successful open', async () => {
        const { clock, advanceTo } = createFakeClock(NOW);
        const { db } = createRuntimeDbStub();
        const registry = new TimerRegistry();
        const zone = buildZoneModel({ id: 'zone-001', name: 'Front Lawn' });
        const cycle = buildPersistedCycle({ id: 'cycle-F', startTime: new Date('2026-05-04T13:00:00.000Z'), durationMin: 5 });
        const { notifier, calls } = recordingNotifier();

        armCycle({
            db, clock, registry, zone, cycle,
            openZone: async () => {},
            closeZone: async () => { throw new Error('close failed'); },
            notifier,
        });
        await advanceTo(new Date('2026-05-04T13:30:00.000Z'));

        expect(calls.some(c => c.event === 'watering-started')).toBe(true);
        const errorCall = calls.find(c => c.event === 'error');
        expect(errorCall?.context).toEqual({ zoneName: 'Front Lawn', operation: 'close', reason: 'close failed' });
    });
});

describe('armCloseOnly', () => {
    const NOW = new Date('2026-05-04T12:00:00.000Z');

    it('schedules the close timer for plannedCloseAt - now and registers the cycle as in-flight', async () => {
        const { clock, advanceTo, getPendingCount } = createFakeClock(NOW);
        const { db, updates } = createRuntimeDbStub();
        const registry = new TimerRegistry();
        const zone = buildZoneModel({ id: 'zone-resume' });
        const cycle = buildPersistedCycle({ id: 'cycle-resume', startTime: new Date('2026-05-04T11:30:00.000Z'), durationMin: 60 });
        const closes: Zone[] = [];
        const plannedCloseAt = new Date('2026-05-04T12:30:00.000Z');

        armCloseOnly({
            db,
            clock,
            registry,
            zone,
            cycle,
            closeZone: async (z) => { closes.push(z); },
            notifier: noopNotifier,
            plannedCloseAt,
        });

        // Pre-registered immediately so getStatus.activeZones reflects the resume.
        expect(registry.snapshotInFlight().map(({ zone }) => zone.id)).toEqual(['zone-resume']);
        expect(getPendingCount()).toBe(1);
        expect(closes).toHaveLength(0);

        await advanceTo(new Date('2026-05-04T12:30:30.000Z'));

        expect(closes).toEqual([zone]);
        expect(updates).toContainEqual({ cycleId: 'cycle-resume', closedAt: plannedCloseAt });
        expect(registry.snapshotInFlight()).toHaveLength(0);
    });

    it('clamps a past plannedCloseAt to a 0-ms delay and fires immediately on the next tick', async () => {
        const { clock, advanceTo } = createFakeClock(NOW);
        const { db, updates } = createRuntimeDbStub();
        const registry = new TimerRegistry();
        const zone = buildZoneModel({ id: 'zone-late' });
        const cycle = buildPersistedCycle({ id: 'cycle-late' });
        const closes: Zone[] = [];

        armCloseOnly({
            db,
            clock,
            registry,
            zone,
            cycle,
            closeZone: async (z) => { closes.push(z); },
            notifier: noopNotifier,
            plannedCloseAt: new Date('2026-05-04T11:00:00.000Z'),
        });

        await advanceTo(NOW);

        expect(closes).toHaveLength(1);
        expect(updates).toHaveLength(1);
        expect(updates[0]?.closedAt).toEqual(NOW);
    });

    it('clears the registry entry and emits an error notification when closeZone rejects', async () => {
        const { clock, advanceTo } = createFakeClock(NOW);
        const { db, updates } = createRuntimeDbStub();
        const registry = new TimerRegistry();
        const zone = buildZoneModel({ id: 'zone-fail', name: 'Fail Zone' });
        const cycle = buildPersistedCycle({ id: 'cycle-fail' });
        const { notifier, calls } = recordingNotifier();

        armCloseOnly({
            db,
            clock,
            registry,
            zone,
            cycle,
            closeZone: async () => { throw new Error('HA timeout'); },
            notifier,
            plannedCloseAt: new Date('2026-05-04T12:30:00.000Z'),
        });

        await advanceTo(new Date('2026-05-04T12:30:30.000Z'));

        expect(updates).toHaveLength(0);
        expect(registry.snapshotInFlight()).toHaveLength(0);
        const errorCall = calls.find(c => c.event === 'error');
        expect(errorCall?.context).toEqual({ zoneName: 'Fail Zone', operation: 'close', reason: 'HA timeout' });
    });
});

describe('closeAllInFlight', () => {
    const NOW = new Date('2026-05-04T12:00:00.000Z');

    it('closes every in-flight relay and records closedAt for each', async () => {
        const { clock } = createFakeClock(NOW);
        const { db, updates } = createRuntimeDbStub();
        const registry = new TimerRegistry();
        const zoneA = buildZoneModel({ id: 'zone-A' });
        const zoneB = buildZoneModel({ id: 'zone-B' });
        registry.addInFlight('cycle-X', zoneA, 999);
        registry.addInFlight('cycle-Y', zoneB, 998);
        const closes: Zone[] = [];
        const closeZone = async (z: Zone) => { closes.push(z); };

        await closeAllInFlight({ db, clock, registry, closeZone, notifier: noopNotifier });

        expect(closes.map(z => z.id)).toEqual(['zone-A', 'zone-B']);
        expect(updates.filter(u => u.closedAt instanceof Date)).toHaveLength(2);
        expect(registry.snapshotInFlight()).toEqual([]);
    });

    it('tolerates a closeZone failure on shutdown and continues with the remaining relays', async () => {
        const { clock } = createFakeClock(NOW);
        const { db, updates } = createRuntimeDbStub();
        const registry = new TimerRegistry();
        registry.addInFlight('cycle-X', buildZoneModel({ id: 'zone-A' }), 999);
        registry.addInFlight('cycle-Y', buildZoneModel({ id: 'zone-B' }), 998);
        let calls = 0;
        const closeZone = async () => {
            calls += 1;
            if (calls === 1) throw new Error('HA flaky');
        };

        await closeAllInFlight({ db, clock, registry, closeZone, notifier: noopNotifier });

        expect(calls).toBe(2);
        expect(updates).toHaveLength(1); // only the second one updated closedAt
        expect(registry.snapshotInFlight()).toEqual([]);
    });

    it('returns immediately when there is nothing in-flight', async () => {
        const { clock } = createFakeClock(NOW);
        const { db, updates } = createRuntimeDbStub();
        const registry = new TimerRegistry();
        const closes: Zone[] = [];

        await closeAllInFlight({ db, clock, registry, closeZone: async (z) => { closes.push(z); }, notifier: noopNotifier });

        expect(closes).toEqual([]);
        expect(updates).toEqual([]);
    });

    it('notifies watering-ended with reason=shutdown for each successfully closed relay', async () => {
        const { clock } = createFakeClock(NOW);
        const { db } = createRuntimeDbStub();
        const registry = new TimerRegistry();
        const zoneA = buildZoneModel({ id: 'zone-A', name: 'Front Lawn' });
        const zoneB = buildZoneModel({ id: 'zone-B', name: 'Back Yard' });
        registry.addInFlight('cycle-X', zoneA, 999);
        registry.addInFlight('cycle-Y', zoneB, 998);
        const { notifier, calls } = recordingNotifier();

        await closeAllInFlight({ db, clock, registry, closeZone: async () => {}, notifier });

        expect(calls.map(c => c.event)).toEqual(['watering-ended', 'watering-ended']);
        expect(calls[0]?.context).toEqual({ zoneName: 'Front Lawn', reason: 'shutdown' });
        expect(calls[1]?.context).toEqual({ zoneName: 'Back Yard', reason: 'shutdown' });
    });

    it('notifies an error when shutdown closeZone fails for a relay', async () => {
        const { clock } = createFakeClock(NOW);
        const { db } = createRuntimeDbStub();
        const registry = new TimerRegistry();
        const zone = buildZoneModel({ id: 'zone-A', name: 'Front Lawn' });
        registry.addInFlight('cycle-X', zone, 999);
        const { notifier, calls } = recordingNotifier();

        await closeAllInFlight({
            db, clock, registry,
            closeZone: async () => { throw new Error('HA flaky'); },
            notifier,
        });

        const errorCall = calls.find(c => c.event === 'error');
        expect(errorCall?.context).toEqual({ zoneName: 'Front Lawn', operation: 'shutdown-close', reason: 'HA flaky' });
        expect(calls.some(c => c.event === 'watering-ended')).toBe(false);
    });
});

type DaemonStubInputs = {
    futureCycles?: FutureCycleJoinedRow[];
    inFlightCycles?: FutureCycleJoinedRow[];
    enabledZones?: ZoneJoinedRow[];
    zoneCounts?: { total: number; enabled: number };
    siteTimezones?: ReadonlyArray<{ timezone: string }>;
    activeSchedules?: ReadonlyArray<{ schedule: {
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
        createdAt: Date;
        updatedAt: Date;
    } }>;
};

function whereContainsIsNotNull(condition: unknown): boolean {
    const seen = new WeakSet<object>();
    function walk(node: unknown): boolean {
        if (typeof node === 'string') return node.includes('is not null');
        if (typeof node !== 'object' || node === null) return false;
        if (seen.has(node)) return false;
        seen.add(node);
        if (Array.isArray(node)) return node.some(walk);
        for (const value of Object.values(node)) {
            if (walk(value)) return true;
        }
        return false;
    }
    return walk(condition);
}

function createDaemonDbStub(inputs?: DaemonStubInputs) {
    const updates: CycleUpdate[] = [];
    const zoneUpdates: Array<{ zoneId: string; currentDepletionMm: number }> = [];
    const inserts: InsertCall[] = [];
    const deletes: DeleteCall[] = [];
    const whereCallsZone: WhereCall[] = [];
    const whereCallsCycles: WhereCall[] = [];
    const counts = inputs?.zoneCounts ?? { total: 1, enabled: 1 };
    // Mutable copy of the seed enabledZones so depletion writes from rePlan
    // are reflected by subsequent loadEnabledZones calls (day-N reads day-(N-1)).
    const enabledZoneRows = inputs?.enabledZones?.map(row => ({ ...row, zone: { ...row.zone } })) ?? [];

    const siteTimezoneRows = inputs?.siteTimezones ?? [{ timezone: 'America/Edmonton' }];

    // Default: one active schedule for site-A (matches the default `siteId`
    // on `buildJoinedRow` / `buildZoneModel`). Tests that need different
    // configurations override.
    const NOW_FOR_SCHEDULES = new Date('2026-05-04T12:00:00.000Z');
    const activeScheduleRows = inputs?.activeSchedules ?? [{
        schedule: {
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
            createdAt: NOW_FOR_SCHEDULES,
            updatedAt: NOW_FOR_SCHEDULES,
        },
    }];

    const db: DaemonDb = {
        select(columns) {
            const cols = columns as Record<string, unknown>;
            if ('total' in cols && 'enabled' in cols) {
                return { from: () => Promise.resolve([counts]) } as never;
            }
            // SiteTimezoneDb shape: a single `timezone` column, no other keys.
            if ('timezone' in cols && Object.keys(cols).length === 1) {
                return { from: () => Promise.resolve([...siteTimezoneRows]) } as never;
            }
            // Schedule manager shape: a single `schedule` column.
            if ('schedule' in cols && Object.keys(cols).length === 1) {
                return {
                    from: () => ({
                        where: () => Promise.resolve([...activeScheduleRows]),
                    }),
                } as never;
            }
            const isFutureCyclesQuery = 'cycle' in cols;
            if (isFutureCyclesQuery) {
                // Differentiate loadFutureCycles (where: isNull(firedAt)) from
                // loadInFlightCycles (where: isNotNull(firedAt)) by inspecting
                // the where condition. Each call resolves to the right list.
                const chain: SelectJoinChain<FutureCycleJoinedRow> = {
                    innerJoin: () => chain,
                    where: (conditions) => {
                        whereCallsCycles.push({ conditions });
                        const rows = whereContainsIsNotNull(conditions)
                            ? (inputs?.inFlightCycles ?? [])
                            : (inputs?.futureCycles ?? []);
                        return Promise.resolve(rows);
                    },
                };
                return { from: () => chain };
            }
            return { from: () => buildJoinChainStub(whereCallsZone, enabledZoneRows) };
        },
        delete(table) {
            return {
                where(conditions) {
                    deletes.push({ table, conditions });
                    return Promise.resolve(undefined);
                },
            };
        },
        insert(table) {
            return {
                values(rows) {
                    return {
                        returning() {
                            inserts.push({ table, rows });
                            if (table === scheduleEntries) {
                                return Promise.resolve(rows.map((_, i) => ({ id: `entry-${inserts.length}-${i}` })));
                            }
                            if (table === irrigationCycles) {
                                return Promise.resolve(rows.map((row, i) => ({
                                    id: `cycle-${inserts.length}-${i}`,
                                    startTime: row['startTime'],
                                    durationMin: row['durationMin'],
                                })));
                            }
                            return Promise.resolve([]);
                        },
                    };
                },
            };
        },
        update(table) {
            const isZonesUpdate = table === zones;
            return {
                set(values) {
                    return {
                        async where(cond) {
                            if (isZonesUpdate) {
                                const zoneId = extractZoneId(cond);
                                const currentDepletionMm = values['currentDepletionMm'];
                                if (typeof currentDepletionMm === 'number') {
                                    zoneUpdates.push({ zoneId, currentDepletionMm });
                                    // Reflect the write back into the stubbed enabledZones so the
                                    // next loadEnabledZones returns the updated value (day-N reads
                                    // day-(N-1)'s persisted depletion, per ticket requirement #3).
                                    for (const row of enabledZoneRows) {
                                        if (row.zone.id === zoneId) row.zone.currentDepletionMm = currentDepletionMm;
                                    }
                                }
                                return Promise.resolve(undefined);
                            }
                            expect(table).toBe(irrigationCycles);
                            const update: CycleUpdate = { cycleId: extractCycleId(cond) };
                            if (values['firedAt'] instanceof Date) update.firedAt = values['firedAt'];
                            if (values['closedAt'] instanceof Date) update.closedAt = values['closedAt'];
                            updates.push(update);
                            return Promise.resolve(undefined);
                        },
                    };
                },
            };
        },
    };

    return { db, updates, zoneUpdates, inserts, deletes };
}

// Walks an `eq(zones.id, X)` condition the same way `extractCycleId` walks the cycle equivalent.
function extractZoneId(cond: unknown): string {
    const seen = new WeakSet<object>();
    function walk(node: unknown): string | undefined {
        if (typeof node === 'string') return /^zone-/.test(node) ? node : undefined;
        if (typeof node !== 'object' || node === null) return undefined;
        if (seen.has(node)) return undefined;
        seen.add(node);
        if (Array.isArray(node)) {
            for (const item of node) {
                const found = walk(item);
                if (found) return found;
            }
            return undefined;
        }
        for (const value of Object.values(node)) {
            const found = walk(value);
            if (found) return found;
        }
        return undefined;
    }
    return walk(cond) ?? '';
}

describe('start', () => {
    const NOW = new Date('2026-05-04T12:00:00.000Z');

    it('arms each future cycle returned by the DB so it fires at its start_time', async () => {
        const futureRow = buildFutureCycleRow({
            cycle: {
                id: 'cycle-existing',
                startTime: new Date('2026-05-04T13:00:00.000Z'),
                durationMin: 10,
            },
        });
        const { db } = createDaemonDbStub({ futureCycles: [futureRow] });
        const { clock, advanceTo } = createFakeClock(NOW);
        const opens: string[] = [];
        const closes: string[] = [];

        await start(db, {
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
        const { db } = createDaemonDbStub();
        // Set initial time to 12:00 UTC, hour=4, tz=UTC -> next re-plan should be 04:00 next day = +16h
        const { clock, getPendingDelays } = createFakeClock(NOW);

        await start(db, { clock, rePlanHourLocal: 4, siteTimezone: 'UTC' });

        const sixteenHoursMs = 16 * 60 * 60 * 1000;
        expect(getPendingDelays()).toContain(sixteenHoursMs);
    });

    it('schedules the next re-plan in the site timezone, not the container timezone', async () => {
        const { db } = createDaemonDbStub();
        // NOW = 2026-05-04T12:00Z = 06:00 MDT. Next 04:00 MDT is tomorrow = 2026-05-05T10:00Z = +22h from now.
        const { clock, getPendingDelays } = createFakeClock(NOW);

        await start(db, { clock, rePlanHourLocal: 4, siteTimezone: 'America/Edmonton' });

        const twentyTwoHoursMs = 22 * 60 * 60 * 1000;
        expect(getPendingDelays()).toContain(twentyTwoHoursMs);
    });

    it('returned rePlan() runs the planner for every enabled zone and inserts the planner output', async () => {
        const enabledRow = buildJoinedRow({ zone: { id: 'zone-loaded', name: 'Loaded Zone' } });
        const { db, inserts, deletes } = createDaemonDbStub({ enabledZones: [enabledRow] });
        const { clock } = createFakeClock(NOW);
        const planned: IrrigationScheduleEntry[] = [
            buildEntry('2026-05-04', [{ startTime: '2026-05-04T13:00:00Z', durationMin: 20 }]),
        ];

        const control = await start(db, {
            clock,
            rePlanHourLocal: 4,
            runPlan: async () => ({ entries: planned, projectedNextDepletionMm: 0 }),
            openZone: async () => {},
            closeZone: async () => {},
        });

        await control.rePlan();

        expect(deletes.length).toBeGreaterThanOrEqual(1);
        expect(inserts.filter(c => c.table === scheduleEntries)).toHaveLength(1);
        expect(inserts.filter(c => c.table === irrigationCycles)).toHaveLength(1);
    });

    it('rePlan() cancels pending open timers from the previous plan', async () => {
        const futureRow = buildFutureCycleRow({
            cycle: {
                id: 'cycle-old',
                startTime: new Date('2026-05-04T15:00:00.000Z'),
                durationMin: 20,
            },
        });
        const enabledRow = buildJoinedRow({ zone: { id: 'zone-loaded' } });
        const { db } = createDaemonDbStub({ futureCycles: [futureRow], enabledZones: [enabledRow] });
        const { clock, advanceTo } = createFakeClock(NOW);
        const opens: string[] = [];

        const control = await start(db, {
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
        const { db, inserts } = createDaemonDbStub({ enabledZones: enabledRows });
        const { clock } = createFakeClock(NOW);
        const planned = buildEntry('2026-05-04', [{ startTime: '2026-05-04T13:00:00Z', durationMin: 20 }]);

        const control = await start(db, {
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

        // Only zone-good should have produced inserts.
        expect(inserts.filter(c => c.table === scheduleEntries)).toHaveLength(1);
    });

    it('shutdown() cancels pending timers and closes any in-flight relay', async () => {
        const futureRow = buildFutureCycleRow({
            cycle: {
                id: 'cycle-inflight',
                startTime: new Date('2026-05-04T13:00:00.000Z'),
                durationMin: 60,
            },
        });
        const { db } = createDaemonDbStub({ futureCycles: [futureRow] });
        const { clock, advanceTo } = createFakeClock(NOW);
        const opens: string[] = [];
        const closes: string[] = [];

        const control = await start(db, {
            clock,
            rePlanHourLocal: 4,
            runPlan: async () => ({ entries: [], projectedNextDepletionMm: 0 }),
            openZone: async (z) => { opens.push(z.id); },
            closeZone: async (z) => { closes.push(z.id); },
        });

        // Advance past the open but before the natural close; the relay is now in-flight.
        await advanceTo(new Date('2026-05-04T13:05:00.000Z'));
        expect(opens).toHaveLength(1);
        expect(closes).toEqual([]);

        await control.shutdown();

        expect(closes).toEqual([futureRow.zone.id]);
    });

    it('shutdown() with no in-flight cycles only cancels timers and resolves quickly', async () => {
        const { db } = createDaemonDbStub();
        const { clock } = createFakeClock(NOW);
        const closes: string[] = [];

        const control = await start(db, {
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
        const { db } = createDaemonDbStub({ enabledZones: [enabledRow] });
        const { clock, advanceTo } = createFakeClock(NOW);
        const planCalls: string[] = [];

        await start(db, {
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

        // Advance to just past the next 04:00 UTC — the scheduled timer should fire and
        // call rePlan, which iterates enabled zones.
        await advanceTo(new Date('2026-05-05T04:00:01.000Z'));

        expect(planCalls).toContain('zone-loaded');
    });

    it('exposes alive=true and a null lastRePlanAt with no activeZones immediately after boot', async () => {
        const { db } = createDaemonDbStub();
        const { clock } = createFakeClock(NOW);

        const control = await start(db, { clock, rePlanHourLocal: 4 });

        expect(control.getStatus()).toEqual({ alive: true, lastRePlanAt: null, activeZones: [] });
    });

    it('records lastRePlanAt as the ISO timestamp at which rePlan() finished', async () => {
        const enabledRow = buildJoinedRow({ zone: { id: 'zone-loaded' } });
        const { db } = createDaemonDbStub({ enabledZones: [enabledRow] });
        const { clock } = createFakeClock(NOW);

        const control = await start(db, {
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
            cycle: {
                id: 'cycle-active',
                startTime: new Date('2026-05-04T13:00:00.000Z'),
                durationMin: 30,
            },
            zone: { id: 'zone-active', name: 'Active Zone' },
        });
        const { db } = createDaemonDbStub({ futureCycles: [futureRow] });
        const { clock, advanceTo } = createFakeClock(NOW);

        const control = await start(db, {
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
            cycle: {
                id: 'cycle-running',
                startTime: new Date('2026-05-04T13:00:00.000Z'),
                durationMin: 30,
            },
        });
        const { db } = createDaemonDbStub({ futureCycles: [futureRow], enabledZones: [] });
        const { clock, advanceTo } = createFakeClock(NOW);
        const opens: string[] = [];
        const closes: string[] = [];

        const control = await start(db, {
            clock,
            rePlanHourLocal: 4,
            runPlan: async () => ({ entries: [], projectedNextDepletionMm: 0 }),
            openZone: async (z) => { opens.push(z.id); },
            closeZone: async (z) => { closes.push(z.id); },
        });

        // Open fires; cycle is now in-flight.
        await advanceTo(new Date('2026-05-04T13:00:01.000Z'));
        expect(opens).toHaveLength(1);
        expect(closes).toEqual([]);

        // rePlan happens mid-cycle. The in-flight close timer should NOT be cancelled.
        await control.rePlan();
        await advanceTo(new Date('2026-05-04T13:30:01.000Z'));

        expect(closes).toEqual([futureRow.zone.id]);
    });

    it('persists projected depletion so the next rePlan reads the updated value, not the seed', async () => {
        const enabledRow = buildJoinedRow({ zone: { id: 'zone-001', currentDepletionMm: 0 } });
        const { db, zoneUpdates } = createDaemonDbStub({ enabledZones: [enabledRow] });
        const { clock } = createFakeClock(NOW);
        const seenDepletionsByCall: number[] = [];

        const control = await start(db, {
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

        expect(zoneUpdates).toEqual([
            { zoneId: 'zone-001', currentDepletionMm: 7.5 },
            { zoneId: 'zone-001', currentDepletionMm: 7.5 },
        ]);
        expect(seenDepletionsByCall).toEqual([0, 7.5]);
    });

    it('flags boot-armed cycles with reason=boot in their watering-started notifications', async () => {
        const futureRow = buildFutureCycleRow({
            cycle: {
                id: 'cycle-boot',
                startTime: new Date('2026-05-04T11:00:00.000Z'),
                durationMin: 8,
            },
            zone: { id: 'zone-boot', name: 'Boot Zone' },
        });
        const { db } = createDaemonDbStub({ futureCycles: [futureRow] });
        const { clock, advanceTo } = createFakeClock(NOW);
        const { notifier, calls } = recordingNotifier();

        await start(db, {
            clock,
            rePlanHourLocal: 4,
            siteTimezone: 'UTC',
            notifier,
            runPlan: async () => ({ entries: [], projectedNextDepletionMm: 0 }),
            openZone: async () => {},
            closeZone: async () => {},
        });

        // Past start time fires immediately on boot.
        await advanceTo(new Date('2026-05-04T12:00:01.000Z'));

        const started = calls.find(c => c.event === 'watering-started');
        expect(started?.context).toEqual({ zoneName: 'Boot Zone', durationMin: 8, reason: 'boot' });
    });

    it('does not flag rePlan-armed cycles with reason=boot in their watering-started notifications', async () => {
        const enabledRow = buildJoinedRow({ zone: { id: 'zone-rp', name: 'Replan Zone' } });
        const { db } = createDaemonDbStub({ enabledZones: [enabledRow] });
        const { clock, advanceTo } = createFakeClock(NOW);
        const { notifier, calls } = recordingNotifier();
        const planned = buildEntry('2026-05-04', [{ startTime: '2026-05-04T13:00:00Z', durationMin: 6 }]);

        const control = await start(db, {
            clock,
            rePlanHourLocal: 4,
            siteTimezone: 'UTC',
            notifier,
            runPlan: async () => ({ entries: [planned], projectedNextDepletionMm: 0 }),
            openZone: async () => {},
            closeZone: async () => {},
        });

        await control.rePlan();
        await advanceTo(new Date('2026-05-04T13:00:30.000Z'));

        const started = calls.find(c => c.event === 'watering-started');
        expect(started?.context).toEqual({ zoneName: 'Replan Zone', durationMin: 6 });
        expect(started?.context).not.toHaveProperty('reason');
    });

    it('emits an error notification when the planner throws for a zone during rePlan', async () => {
        const enabledRow = buildJoinedRow({ zone: { id: 'zone-bad', name: 'Bad Zone' } });
        const { db } = createDaemonDbStub({ enabledZones: [enabledRow] });
        const { clock } = createFakeClock(NOW);
        const { notifier, calls } = recordingNotifier();

        const control = await start(db, {
            clock,
            rePlanHourLocal: 4,
            siteTimezone: 'UTC',
            notifier,
            runPlan: async () => { throw new Error('forecast unavailable'); },
            openZone: async () => {},
            closeZone: async () => {},
            getZoneState: async () => 'off',
        });

        await control.rePlan();

        const errorCall = calls.find(c => c.event === 'error');
        expect(errorCall?.context).toEqual({ zoneName: 'Bad Zone', operation: 're-plan', reason: 'forecast unavailable' });
    });

    describe('cross-zone deconfliction', () => {
        type RunPlanCall = {
            zoneId: string;
            busyWindows: ReadonlyArray<{ start: Date; end: Date }>;
        };

        it('passes the first zone\'s persisted cycle as a busy window to the second zone\'s planner', async () => {
            const enabledRows = [
                buildJoinedRow({ zone: { id: 'zone-A', name: 'Zone A' } }),
                buildJoinedRow({ zone: { id: 'zone-B', name: 'Zone B' } }),
            ];
            const { db } = createDaemonDbStub({ enabledZones: enabledRows });
            const { clock } = createFakeClock(NOW);
            const calls: RunPlanCall[] = [];
            const zoneAEntry = buildEntry('2026-05-04', [{ startTime: '2026-05-04T05:00:00Z', durationMin: 30 }]);
            const zoneBEntry = buildEntry('2026-05-04', [{ startTime: '2026-05-04T05:10:00Z', durationMin: 30 }]);

            const control = await start(db, {
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
            expect(calls[0]).toEqual({ zoneId: 'zone-A', busyWindows: [] });
            expect(calls[1]?.zoneId).toBe('zone-B');
            expect(calls[1]?.busyWindows).toHaveLength(1);
            const zoneABusy = calls[1]!.busyWindows[0]!;
            expect(zoneABusy.start.toISOString()).toBe('2026-05-04T05:00:00.000Z');
            expect(zoneABusy.end.toISOString()).toBe('2026-05-04T05:30:00.000Z');
        });

        it('accumulates busy windows across three zones in iteration order', async () => {
            const enabledRows = [
                buildJoinedRow({ zone: { id: 'zone-A' } }),
                buildJoinedRow({ zone: { id: 'zone-B' } }),
                buildJoinedRow({ zone: { id: 'zone-C' } }),
            ];
            const { db } = createDaemonDbStub({ enabledZones: enabledRows });
            const { clock } = createFakeClock(NOW);
            const calls: RunPlanCall[] = [];
            const entryFor = (zoneId: string, start: string, durationMin: number) =>
                buildEntry('2026-05-04', [{ startTime: start, durationMin }]);

            const control = await start(db, {
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

            expect(calls.map(c => c.busyWindows.length)).toEqual([0, 1, 2]);
            const zoneCBusy = calls[2]!.busyWindows;
            expect(zoneCBusy[0]?.start.toISOString()).toBe('2026-05-04T05:00:00.000Z');
            expect(zoneCBusy[0]?.end.toISOString()).toBe('2026-05-04T05:20:00.000Z');
            expect(zoneCBusy[1]?.start.toISOString()).toBe('2026-05-04T05:30:00.000Z');
            expect(zoneCBusy[1]?.end.toISOString()).toBe('2026-05-04T05:50:00.000Z');
        });

        it('omits a failed zone\'s windows from the busy set passed to subsequent zones', async () => {
            const enabledRows = [
                buildJoinedRow({ zone: { id: 'zone-A' } }),
                buildJoinedRow({ zone: { id: 'zone-bad' } }),
                buildJoinedRow({ zone: { id: 'zone-C' } }),
            ];
            const { db } = createDaemonDbStub({ enabledZones: enabledRows });
            const { clock } = createFakeClock(NOW);
            const calls: RunPlanCall[] = [];

            const control = await start(db, {
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
            // zone-C must see only zone-A's window — not the failed zone's.
            expect(calls[2]?.busyWindows).toHaveLength(1);
            expect(calls[2]?.busyWindows[0]?.start.toISOString()).toBe('2026-05-04T05:00:00.000Z');
        });
    });

    describe('schedule integration', () => {
        it('forwards the active schedule\'s rootDepthMOverride and allowableDepletionFractionOverride to runPlan', async () => {
            const enabledRow = buildJoinedRow({ zone: { id: 'zone-o', siteId: 'site-O' } });
            const { db } = createDaemonDbStub({
                enabledZones: [enabledRow],
                activeSchedules: [{
                    schedule: {
                        id: 'sched-o', siteId: 'site-O', slug: 'overseeding', name: 'Overseeding',
                        isActive: true,
                        allowedDays: null,
                        allowedTimeWindows: null,
                        rootDepthMOverride: 0.05,
                        allowableDepletionFractionOverride: 0.25,
                        createdAt: NOW, updatedAt: NOW,
                    },
                }],
            });
            const { clock } = createFakeClock(NOW);
            const planCalls: Array<{ rootDepthM: number | undefined; allowableDepletionFraction: number | undefined }> = [];

            const control = await start(db, {
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
            const { db } = createDaemonDbStub({
                enabledZones: [enabledRow],
                activeSchedules: [{
                    schedule: {
                        id: 'sched-n', siteId: 'site-N', slug: 'maintenance', name: 'Maintenance',
                        isActive: true,
                        allowedDays: null,
                        allowedTimeWindows: null,
                        rootDepthMOverride: null,
                        allowableDepletionFractionOverride: null,
                        endBySunrise: null,
                        createdAt: NOW, updatedAt: NOW,
                    },
                }],
            });
            const { clock } = createFakeClock(NOW);
            const planCalls: Array<{ rootDepthM: number | undefined; allowableDepletionFraction: number | undefined }> = [];

            const control = await start(db, {
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

        it('forwards the active schedule\'s allowedDays and allowedTimeWindows to runPlan', async () => {
            const enabledRow = buildJoinedRow({ zone: { id: 'zone-r', siteId: 'site-R' } });
            const { db } = createDaemonDbStub({
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
                        rootDepthMOverride: null,
                        allowableDepletionFractionOverride: null,
                        endBySunrise: null,
                        createdAt: NOW, updatedAt: NOW,
                    },
                }],
            });
            const { clock } = createFakeClock(NOW);
            const planCalls: Array<{ allowedDays: number[] | null | undefined; allowedTimeWindows: unknown; endBySunrise: unknown }> = [];

            const control = await start(db, {
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
            const { db } = createDaemonDbStub({
                enabledZones: [enabledRow],
                activeSchedules: [{
                    schedule: {
                        id: 'sched-ebs', siteId: 'site-EBS', slug: 'maintenance', name: 'Maintenance',
                        isActive: true,
                        allowedDays: null,
                        allowedTimeWindows: null,
                        rootDepthMOverride: null,
                        allowableDepletionFractionOverride: null,
                        endBySunrise: true,
                        createdAt: NOW, updatedAt: NOW,
                    },
                }],
            });
            const { clock } = createFakeClock(NOW);
            const planCalls: Array<{ endBySunrise: unknown }> = [];

            const control = await start(db, {
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
            const { db, inserts } = createDaemonDbStub({
                enabledZones: [enabledRow],
                activeSchedules: [{
                    schedule: {
                        id: 'sched-active', siteId: 'site-A', slug: 'maintenance', name: 'Maintenance',
                        isActive: true, allowedDays: null, allowedTimeWindows: null, rootDepthMOverride: null, allowableDepletionFractionOverride: null, endBySunrise: null, createdAt: NOW, updatedAt: NOW,
                    },
                }],
            });
            const { clock } = createFakeClock(NOW);
            const planned = buildEntry('2026-05-04', [{ startTime: '2026-05-04T13:00:00Z', durationMin: 20 }]);

            const control = await start(db, {
                clock,
                rePlanHourLocal: 4,
                runPlan: async () => ({ entries: [planned], projectedNextDepletionMm: 0 }),
                openZone: async () => {},
                closeZone: async () => {},
                getZoneState: async () => 'off',
            });

            await control.rePlan();

            const entryInserts = inserts.filter(c => c.table === scheduleEntries);
            expect(entryInserts).toHaveLength(1);
            expect(entryInserts[0]?.rows[0]?.['scheduleId']).toBe('sched-active');
        });

        it('skips a zone whose site has no active schedule and logs a warning', async () => {
            const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
            try {
                const enabledRow = buildJoinedRow({ zone: { id: 'zone-orphan', siteId: 'site-no-schedule' } });
                const { db, inserts } = createDaemonDbStub({
                    enabledZones: [enabledRow],
                    activeSchedules: [], // no active schedules anywhere
                });
                const { clock } = createFakeClock(NOW);
                const planCalls: string[] = [];

                const control = await start(db, {
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
                expect(inserts.filter(c => c.table === scheduleEntries)).toHaveLength(0);
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
                const { db, inserts } = createDaemonDbStub({
                    enabledZones: [skipped, planned],
                    activeSchedules: [{
                        schedule: {
                            id: 'sched-A', siteId: 'site-active', slug: 'maintenance', name: 'Maintenance',
                            isActive: true, allowedDays: null, allowedTimeWindows: null, rootDepthMOverride: null, allowableDepletionFractionOverride: null, endBySunrise: null, createdAt: NOW, updatedAt: NOW,
                        },
                    }],
                });
                const { clock } = createFakeClock(NOW);
                const planCalls: string[] = [];
                const entry = buildEntry('2026-05-04', [{ startTime: '2026-05-04T13:00:00Z', durationMin: 10 }]);

                const control = await start(db, {
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
                const entryInserts = inserts.filter(c => c.table === scheduleEntries);
                expect(entryInserts).toHaveLength(1);
                expect(entryInserts[0]?.rows[0]?.['scheduleId']).toBe('sched-A');
            } finally {
                warnSpy.mockRestore();
            }
        });
    });

    describe('startup reconciliation', () => {
        it('runs reconciliation before arming any future cycles from the boot loop', async () => {
            const futureRow = buildFutureCycleRow({
                cycle: {
                    id: 'cycle-future',
                    startTime: new Date('2026-05-04T13:00:00.000Z'),
                    durationMin: 10,
                    firedAt: null,
                },
            });
            const inFlightRow = buildFutureCycleRow({
                cycle: {
                    id: 'cycle-inflight',
                    startTime: new Date('2026-05-04T11:00:00.000Z'),
                    durationMin: 90,
                    firedAt: new Date('2026-05-04T11:00:00.000Z'),
                    closedAt: null,
                },
                zone: { id: 'zone-inflight' },
            });
            const { db } = createDaemonDbStub({ futureCycles: [futureRow], inFlightCycles: [inFlightRow] });
            const { clock } = createFakeClock(NOW);
            const events: string[] = [];

            await start(db, {
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

            // The first event must be a state query for the in-flight zone (reconcile),
            // not the future cycle's open. armCycle for future cycles only schedules
            // a setTimeout, so it doesn't add events here — but the state query proves
            // reconcile ran first.
            expect(events[0]).toBe('state:zone-inflight');
        });

        it('logs the reconcile summary line at startup', async () => {
            const inFlightRow = buildFutureCycleRow({
                cycle: {
                    id: 'cycle-running',
                    startTime: new Date('2026-05-04T11:00:00.000Z'),
                    durationMin: 30,
                    firedAt: new Date('2026-05-04T11:00:00.000Z'),
                    closedAt: null,
                },
                zone: { id: 'zone-running' },
            });
            const { db } = createDaemonDbStub({ inFlightCycles: [inFlightRow] });
            const { clock } = createFakeClock(NOW);
            const logSpy = spyOn(console, 'log').mockImplementation(() => {});

            try {
                await start(db, {
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
            const { db: baseDb } = createDaemonDbStub();
            const erroringDb: DaemonDb = {
                ...baseDb,
                select: ((cols: Record<string, unknown>) => {
                    if ('cycle' in cols) {
                        return {
                            from: () => ({
                                innerJoin: function () { return this; },
                                where: () => Promise.reject(new Error('db down')),
                            }),
                        };
                    }
                    return baseDb.select(cols as never);
                }) as never,
            };
            const { clock } = createFakeClock(NOW);

            await expect(start(erroringDb, {
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
            const { db } = createDaemonDbStub({ zoneCounts: { total: 0, enabled: 0 } });
            const { clock } = createFakeClock(NOW);

            await start(db, { clock, rePlanHourLocal: 4 });

            const messages = warnSpy.mock.calls.map((args: unknown[]) => String(args[0]));
            expect(messages.some((m: string) => m.includes('has no zones to manage') && m.includes('bun run seed'))).toBe(true);
        });

        it('warns that all zones are disabled when total > 0 but enabled is zero', async () => {
            const { db } = createDaemonDbStub({ zoneCounts: { total: 4, enabled: 0 } });
            const { clock } = createFakeClock(NOW);

            await start(db, { clock, rePlanHourLocal: 4 });

            const messages = warnSpy.mock.calls.map((args: unknown[]) => String(args[0]));
            expect(messages.some((m: string) => m.includes('all zones are disabled'))).toBe(true);
            expect(messages.some((m: string) => m.includes('has no zones to manage'))).toBe(false);
        });

        it('emits no startup warning when at least one zone is enabled', async () => {
            const { db } = createDaemonDbStub({ zoneCounts: { total: 4, enabled: 2 } });
            const { clock } = createFakeClock(NOW);

            await start(db, { clock, rePlanHourLocal: 4 });

            expect(warnSpy).not.toHaveBeenCalled();
        });
    });
});
