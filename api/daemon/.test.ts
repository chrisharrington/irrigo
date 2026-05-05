import { describe, it, expect } from 'bun:test';
import dayjs from 'dayjs';
import {
    grassTypes,
    irrigationCycles,
    scheduleEntries,
    sites,
    soilTypes,
    zones,
} from '@/db/schema';
import type { IrrigationScheduleEntry } from '@/models';
import {
    loadEnabledZones,
    mapJoinedRowsToZones,
    type ZoneJoinedRow,
    type ZoneLoaderDb,
} from './zones';
import {
    loadFutureCycles,
    replaceZoneSchedule,
    type FutureCycleJoinedRow,
    type FutureCyclesDb,
    type ScheduleWriterDb,
} from './schedules';

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

function createZoneLoaderStub(rows: ZoneJoinedRow[]) {
    const whereCalls: WhereCall[] = [];
    let selectColumns: unknown;

    const db: ZoneLoaderDb = {
        select(columns) {
            selectColumns = columns;
            return {
                from() {
                    return {
                        innerJoin() {
                            return {
                                innerJoin() {
                                    return {
                                        innerJoin() {
                                            return {
                                                where(conditions) {
                                                    whereCalls.push({ conditions });
                                                    return Promise.resolve(rows);
                                                },
                                            };
                                        },
                                    };
                                },
                            };
                        },
                    };
                },
            };
        },
    };

    return {
        db,
        whereCalls,
        getSelectColumns: () => selectColumns,
    };
}

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
            return {
                from() {
                    return {
                        innerJoin() {
                            return {
                                innerJoin() {
                                    return {
                                        innerJoin() {
                                            return {
                                                innerJoin() {
                                                    return {
                                                        innerJoin() {
                                                            return {
                                                                where(conditions) {
                                                                    whereCalls.push({ conditions });
                                                                    return Promise.resolve(rows);
                                                                },
                                                            };
                                                        },
                                                    };
                                                },
                                            };
                                        },
                                    };
                                },
                            };
                        },
                    };
                },
            };
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
