import { afterEach, beforeEach, describe, it, expect, spyOn } from 'bun:test';
import dayjs from 'dayjs';
import {
    grassTypes,
    irrigationCycles,
    scheduleEntries,
    sites,
    soilTypes,
    zones,
} from '@/db/schema';
import type { IrrigationScheduleEntry, Zone } from '@/models';
import { computeNextRePlanAt, start, type DaemonDb } from '.';
import {
    countZones,
    loadEnabledZones,
    mapJoinedRowsToZones,
    type SelectJoinChain,
    type ZoneCountDb,
    type ZoneJoinedRow,
    type ZoneLoaderDb,
} from './zones';
import {
    loadFutureCycles,
    replaceZoneSchedule,
    type FutureCycleJoinedRow,
    type FutureCyclesDb,
    type PersistedCycle,
    type ScheduleWriterDb,
} from './schedules';
import {
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

type DeleteCall = { table: unknown; conditions: unknown };
type InsertCall = { table: unknown; rows: ReadonlyArray<Record<string, unknown>> };

function createScheduleWriterStub(idPlan?: { entries?: string[]; cycles?: string[][] }) {
    const deleteCalls: DeleteCall[] = [];
    const insertCalls: InsertCall[] = [];
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
    };

    return { db, deleteCalls, insertCalls };
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

        await replaceZoneSchedule(db, 'zone-001', [entry], '2026-05-04');

        expect(deleteCalls).toHaveLength(1);
        expect(deleteCalls[0]?.table).toBe(scheduleEntries);
        expect(insertCalls.length).toBeGreaterThan(0);
    });

    it('inserts one schedule_entries row per planner entry with the right zoneId, date, and depletion fields', async () => {
        const { db, insertCalls } = createScheduleWriterStub({ entries: ['entry-A', 'entry-B'] });
        const entries = [
            buildEntry('2026-05-04', [{ startTime: '2026-05-04T05:00:00Z', durationMin: 20 }]),
            buildEntry('2026-05-06', [{ startTime: '2026-05-06T05:00:00Z', durationMin: 25 }]),
        ];

        await replaceZoneSchedule(db, 'zone-001', entries, '2026-05-04');

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

        await replaceZoneSchedule(db, 'zone-001', [entry], '2026-05-04');

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

        const result = await replaceZoneSchedule(db, 'zone-001', [entry], '2026-05-04');

        expect(result.cycles).toHaveLength(2);
        expect(result.cycles[0]?.id).toBe('cycle-A1');
        expect(result.cycles[0]?.durationMin).toBe(20);
        expect(result.cycles[1]?.id).toBe('cycle-A2');
        expect(result.cycles[1]?.durationMin).toBe(15);
    });

    it('still issues the delete and inserts no rows when given an empty entries array', async () => {
        const { db, deleteCalls, insertCalls } = createScheduleWriterStub();

        const result = await replaceZoneSchedule(db, 'zone-001', [], '2026-05-04');

        expect(deleteCalls).toHaveLength(1);
        expect(insertCalls).toHaveLength(0);
        expect(result.cycles).toEqual([]);
    });

    it('skips cycle inserts when the planner entry has no cycles for the day', async () => {
        const { db, insertCalls } = createScheduleWriterStub({ entries: ['entry-A'] });
        const entry = buildEntry('2026-05-04', []);

        const result = await replaceZoneSchedule(db, 'zone-001', [entry], '2026-05-04');

        expect(insertCalls.filter(c => c.table === scheduleEntries)).toHaveLength(1);
        expect(insertCalls.filter(c => c.table === irrigationCycles)).toHaveLength(0);
        expect(result.cycles).toEqual([]);
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

describe('computeNextRePlanAt', () => {
    it('returns todays hour when the current time is before that hour', () => {
        const now = new Date('2026-05-04T01:30:00.000Z');
        const next = computeNextRePlanAt(now, 4);

        expect(dayjs(next).format('YYYY-MM-DDTHH:mm')).toBe(dayjs(now).hour(4).minute(0).format('YYYY-MM-DDTHH:mm'));
    });

    it('returns tomorrows hour when the current time is past todays hour', () => {
        const now = new Date('2026-05-04T18:30:00.000Z');
        const next = computeNextRePlanAt(now, 4);

        const expected = dayjs(now).add(1, 'day').hour(4).minute(0).second(0).millisecond(0);
        expect(dayjs(next).format('YYYY-MM-DDTHH:mm:ss')).toBe(expected.format('YYYY-MM-DDTHH:mm:ss'));
    });

    it('returns tomorrows hour when the current time exactly matches todays hour', () => {
        const now = dayjs(NOW_DAEMON).hour(4).minute(0).second(0).millisecond(0).toDate();
        const next = computeNextRePlanAt(now, 4);

        expect(dayjs(next).diff(dayjs(now), 'hour')).toBe(24);
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

        armCycle({ db, clock, registry, zone, cycle, openZone, closeZone });

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

        armCycle({ db, clock, registry, zone, cycle, openZone, closeZone });
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

        armCycle({ db, clock, registry, zone, cycle, openZone, closeZone });
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

        armCycle({ db, clock, registry, zone, cycle, openZone, closeZone });
        await advanceTo(new Date('2026-05-04T12:05:01.000Z'));

        expect(opens).toHaveLength(1);
        expect(updates.length).toBeGreaterThanOrEqual(1);
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

        await closeAllInFlight({ db, clock, registry, closeZone });

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

        await closeAllInFlight({ db, clock, registry, closeZone });

        expect(calls).toBe(2);
        expect(updates).toHaveLength(1); // only the second one updated closedAt
        expect(registry.snapshotInFlight()).toEqual([]);
    });

    it('returns immediately when there is nothing in-flight', async () => {
        const { clock } = createFakeClock(NOW);
        const { db, updates } = createRuntimeDbStub();
        const registry = new TimerRegistry();
        const closes: Zone[] = [];

        await closeAllInFlight({ db, clock, registry, closeZone: async (z) => { closes.push(z); } });

        expect(closes).toEqual([]);
        expect(updates).toEqual([]);
    });
});

type DaemonStubInputs = {
    futureCycles?: FutureCycleJoinedRow[];
    enabledZones?: ZoneJoinedRow[];
    zoneCounts?: { total: number; enabled: number };
};

function createDaemonDbStub(inputs?: DaemonStubInputs) {
    const updates: CycleUpdate[] = [];
    const inserts: InsertCall[] = [];
    const deletes: DeleteCall[] = [];
    const whereCallsZone: WhereCall[] = [];
    const whereCallsCycles: WhereCall[] = [];
    const counts = inputs?.zoneCounts ?? { total: 1, enabled: 1 };

    const db: DaemonDb = {
        select(columns) {
            const cols = columns as Record<string, unknown>;
            if ('total' in cols && 'enabled' in cols) {
                return { from: () => Promise.resolve([counts]) } as never;
            }
            const isFutureCyclesQuery = 'cycle' in cols;
            const rows = (isFutureCyclesQuery ? inputs?.futureCycles : inputs?.enabledZones) ?? [];
            const whereSink = isFutureCyclesQuery ? whereCallsCycles : whereCallsZone;
            return { from: () => buildJoinChainStub(whereSink, rows) };
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
            expect(table).toBe(irrigationCycles);
            return {
                set(values) {
                    return {
                        async where(cond) {
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

    return { db, updates, inserts, deletes };
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
            runPlan: async () => [],
            openZone: async (z) => { opens.push(z.id); },
            closeZone: async (z) => { closes.push(z.id); },
        });

        await advanceTo(new Date('2026-05-04T13:10:01.000Z'));

        expect(opens).toEqual([futureRow.zone.id]);
        expect(closes).toEqual([futureRow.zone.id]);
    });

    it('schedules the next re-plan timer for the configured local hour', async () => {
        const { db } = createDaemonDbStub();
        // Set initial time to 12:00, hour=4 -> next re-plan should be 04:00 next day = +16h
        const { clock, getPendingDelays } = createFakeClock(NOW);

        await start(db, { clock, rePlanHourLocal: 4 });

        const sixteenHoursMs = 16 * 60 * 60 * 1000;
        expect(getPendingDelays()).toContain(sixteenHoursMs);
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
            runPlan: async () => planned,
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
            runPlan: async () => [],
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
                return [planned];
            },
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
            runPlan: async () => [],
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
            runPlan: async () => [],
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
            runPlan: async (z) => {
                planCalls.push(z.id);
                return [];
            },
            openZone: async () => {},
            closeZone: async () => {},
        });

        // Advance to just past the next 04:00 — the scheduled timer should fire and
        // call rePlan, which iterates enabled zones.
        await advanceTo(new Date('2026-05-05T04:00:01.000Z'));

        expect(planCalls).toContain('zone-loaded');
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
            runPlan: async () => [],
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
