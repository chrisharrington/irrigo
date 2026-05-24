import { describe, expect, it } from 'bun:test';
import dayjs from 'dayjs';
import type { Database } from '@/db';
import {
    grassTypes,
    irrigationCycles,
    scheduleEntries,
    sites,
    soilTypes,
    zones,
} from '@/db/schema';
import type { IrrigationScheduleEntry } from '@/models';
import type { ZoneJoinedRow } from '@/repositories/zones';
import { createScheduleEntriesRepository, type NextRunJoinedRow } from '.';

const NOW = new Date('2026-05-04T12:00:00.000Z');

type WhereCall = { conditions: unknown };
type DeleteCall = { table: unknown; conditions: unknown };
type InsertCall = { table: unknown; rows: ReadonlyArray<Record<string, unknown>> };
type UpdateCall = { table: unknown; values: Record<string, unknown>; conditions: unknown };

type FutureCycleJoinedRow = {
    cycle: typeof irrigationCycles.$inferSelect;
    scheduleEntry: typeof scheduleEntries.$inferSelect;
} & ZoneJoinedRow;

function buildJoinedZone(overrides?: Partial<{
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
            id: 'grass-001', slug: 'kbg', name: 'KBG', cropCoefficient: 0.85,
            createdAt: NOW, updatedAt: NOW,
            ...overrides?.grassType,
        },
        soilType: {
            id: 'soil-001', slug: 'loam', name: 'Loam',
            availableWaterHoldingCapacityMmPerM: 150, infiltrationRateMmPerHr: 25,
            createdAt: NOW, updatedAt: NOW,
            ...overrides?.soilType,
        },
        site: {
            id: 'site-001', slug: 'home', name: 'Home',
            timezone: 'America/Edmonton', latitude: 51.05, longitude: -114.07, address: null,
            createdAt: NOW, updatedAt: NOW,
            ...overrides?.site,
        },
    };
}

function buildFutureCycleRow(overrides?: Partial<{
    cycle: Partial<FutureCycleJoinedRow['cycle']>;
    scheduleEntry: Partial<FutureCycleJoinedRow['scheduleEntry']>;
    zone: Partial<FutureCycleJoinedRow['zone']>;
    site: Partial<FutureCycleJoinedRow['site']>;
}>): FutureCycleJoinedRow {
    const base = buildJoinedZone({ zone: overrides?.zone, site: overrides?.site });
    return {
        ...base,
        cycle: {
            id: 'cycle-001',
            scheduleEntryId: 'entry-001',
            startTime: new Date('2026-05-05T05:00:00.000Z'),
            durationMin: 25,
            firedAt: null,
            closedAt: null,
            createdAt: NOW,
            updatedAt: NOW,
            ...overrides?.cycle,
        },
        scheduleEntry: {
            id: 'entry-001',
            zoneId: base.zone.id,
            scheduleId: 'sched-001',
            date: '2026-05-05',
            appliedDepthMm: 12,
            depletionBeforeMm: 18.5,
            depletionAfterMm: 0,
            sunriseAt: null,
            source: 'scheduled',
            createdAt: NOW,
            updatedAt: NOW,
            ...overrides?.scheduleEntry,
        },
    };
}

function stubLoaderDb(rows: FutureCycleJoinedRow[]): { db: Database; whereCalls: WhereCall[]; getSelectColumns: () => unknown } {
    const whereCalls: WhereCall[] = [];
    let selectColumns: unknown;
    const chain = {
        innerJoin: () => chain,
        where: (conditions: unknown) => {
            whereCalls.push({ conditions });
            return Promise.resolve(rows);
        },
    };
    const db = {
        select(columns: unknown) {
            selectColumns = columns;
            return { from: () => chain };
        },
    } as unknown as Database;
    return { db, whereCalls, getSelectColumns: () => selectColumns };
}

function stubWriterDb(idPlan?: { entries?: string[]; cycles?: string[][] }) {
    const deleteCalls: DeleteCall[] = [];
    const insertCalls: InsertCall[] = [];
    const updateCalls: UpdateCall[] = [];
    let entryIdx = 0;
    let cycleBatchIdx = 0;

    const runDeleteWhere = async (table: unknown, conditions: unknown): Promise<void> => {
        deleteCalls.push({ table, conditions });
    };

    const runInsertReturning = async (table: unknown, rows: ReadonlyArray<Record<string, unknown>>): Promise<Array<Record<string, unknown>>> => {
        insertCalls.push({ table, rows });
        if (table === scheduleEntries) {
            const id = idPlan?.entries?.[entryIdx] ?? `entry-${entryIdx}`;
            entryIdx += 1;
            return [{ id }];
        }
        if (table === irrigationCycles) {
            const ids = idPlan?.cycles?.[cycleBatchIdx] ?? rows.map((_, i) => `cycle-${cycleBatchIdx}-${i}`);
            cycleBatchIdx += 1;
            return rows.map((row, i) => ({
                id: ids[i],
                startTime: row['startTime'],
                durationMin: row['durationMin'],
            }));
        }
        return [];
    };

    const runUpdateWhere = async (table: unknown, values: Record<string, unknown>, conditions: unknown): Promise<void> => {
        updateCalls.push({ table, values, conditions });
    };

    const db = {
        delete: (table: unknown) => ({ where: (conditions: unknown) => runDeleteWhere(table, conditions) }),
        insert: (table: unknown) => ({ values: (rows: ReadonlyArray<Record<string, unknown>>) => ({ returning: () => runInsertReturning(table, rows) }) }),
        update: (table: unknown) => ({ set: (values: Record<string, unknown>) => ({ where: (conditions: unknown) => runUpdateWhere(table, values, conditions) }) }),
    } as unknown as Database;

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

describe('createScheduleEntriesRepository.replaceForZone', () => {
    it('issues a delete on schedule_entries for the zone before any inserts', async () => {
        const { db, deleteCalls, insertCalls } = stubWriterDb();
        const repo = createScheduleEntriesRepository(db);
        const entry = buildEntry('2026-05-04', [{ startTime: '2026-05-04T05:00:00Z', durationMin: 20 }]);

        await repo.replaceForZone('zone-001', [entry], dayjs('2026-05-04'), 0, 'sched-default');

        expect(deleteCalls).toHaveLength(1);
        expect(deleteCalls[0]?.table).toBe(scheduleEntries);
        expect(insertCalls.length).toBeGreaterThan(0);
    });

    it('stamps the supplied scheduleId on each inserted schedule_entries row', async () => {
        const { db, insertCalls } = stubWriterDb({ entries: ['entry-A', 'entry-B'] });
        const repo = createScheduleEntriesRepository(db);
        const entries = [
            buildEntry('2026-05-04', [{ startTime: '2026-05-04T05:00:00Z', durationMin: 20 }]),
            buildEntry('2026-05-06', [{ startTime: '2026-05-06T05:00:00Z', durationMin: 25 }]),
        ];

        await repo.replaceForZone('zone-001', entries, dayjs('2026-05-04'), 0, 'sched-overseed');

        const entryInserts = insertCalls.filter(c => c.table === scheduleEntries);
        expect(entryInserts).toHaveLength(2);
        for (const call of entryInserts) {
            expect(call.rows[0]?.['scheduleId']).toBe('sched-overseed');
        }
    });

    it('inserts one schedule_entries row per planner entry with the right zoneId, date, and depletion fields', async () => {
        const { db, insertCalls } = stubWriterDb({ entries: ['entry-A', 'entry-B'] });
        const repo = createScheduleEntriesRepository(db);
        const entries = [
            buildEntry('2026-05-04', [{ startTime: '2026-05-04T05:00:00Z', durationMin: 20 }]),
            buildEntry('2026-05-06', [{ startTime: '2026-05-06T05:00:00Z', durationMin: 25 }]),
        ];

        await repo.replaceForZone('zone-001', entries, dayjs('2026-05-04'), 0, 'sched-default');

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
        const { db, insertCalls } = stubWriterDb({ entries: ['entry-A'] });
        const repo = createScheduleEntriesRepository(db);
        const entry = buildEntry('2026-05-04', [
            { startTime: '2026-05-04T05:00:00Z', durationMin: 20 },
            { startTime: '2026-05-04T05:30:00Z', durationMin: 15 },
        ]);

        await repo.replaceForZone('zone-001', [entry], dayjs('2026-05-04'), 0, 'sched-default');

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
        const { db } = stubWriterDb({
            entries: ['entry-A'],
            cycles: [['cycle-A1', 'cycle-A2']],
        });
        const repo = createScheduleEntriesRepository(db);
        const entry = buildEntry('2026-05-04', [
            { startTime: '2026-05-04T05:00:00Z', durationMin: 20 },
            { startTime: '2026-05-04T05:30:00Z', durationMin: 15 },
        ]);

        const result = await repo.replaceForZone('zone-001', [entry], dayjs('2026-05-04'), 0, 'sched-default');

        expect(result.cycles).toHaveLength(2);
        expect(result.cycles[0]?.id).toBe('cycle-A1');
        expect(result.cycles[0]?.durationMin).toBe(20);
        expect(result.cycles[0]?.entryDate).toBe('2026-05-04');
        expect(result.cycles[1]?.id).toBe('cycle-A2');
        expect(result.cycles[1]?.durationMin).toBe(15);
        expect(result.cycles[1]?.entryDate).toBe('2026-05-04');
    });

    it('tags each persisted cycle with its source entry date when multiple nights are planned together', async () => {
        const { db } = stubWriterDb({
            entries: ['entry-A', 'entry-B'],
            cycles: [['cycle-A1'], ['cycle-B1']],
        });
        const repo = createScheduleEntriesRepository(db);
        const entries = [
            buildEntry('2026-05-04', [{ startTime: '2026-05-04T05:00:00Z', durationMin: 20 }]),
            buildEntry('2026-05-05', [{ startTime: '2026-05-05T05:00:00Z', durationMin: 15 }]),
        ];

        const result = await repo.replaceForZone('zone-001', entries, dayjs('2026-05-04'), 0, 'sched-default');

        expect(result.cycles).toHaveLength(2);
        expect(result.cycles[0]?.entryDate).toBe('2026-05-04');
        expect(result.cycles[1]?.entryDate).toBe('2026-05-05');
    });

    it('still issues the delete and inserts no rows when given an empty entries array', async () => {
        const { db, deleteCalls, insertCalls } = stubWriterDb();
        const repo = createScheduleEntriesRepository(db);

        const result = await repo.replaceForZone('zone-001', [], dayjs('2026-05-04'), 0, 'sched-default');

        expect(deleteCalls).toHaveLength(1);
        expect(insertCalls).toHaveLength(0);
        expect(result.cycles).toEqual([]);
    });

    it('skips cycle inserts when the planner entry has no cycles for the day', async () => {
        const { db, insertCalls } = stubWriterDb({ entries: ['entry-A'] });
        const repo = createScheduleEntriesRepository(db);
        const entry = buildEntry('2026-05-04', []);

        const result = await repo.replaceForZone('zone-001', [entry], dayjs('2026-05-04'), 0, 'sched-default');

        expect(insertCalls.filter(c => c.table === scheduleEntries)).toHaveLength(1);
        expect(insertCalls.filter(c => c.table === irrigationCycles)).toHaveLength(0);
        expect(result.cycles).toEqual([]);
    });

    it('writes the projected next-day depletion to zones.current_depletion_mm', async () => {
        const { db, updateCalls } = stubWriterDb();
        const repo = createScheduleEntriesRepository(db);
        const entry = buildEntry('2026-05-04', [{ startTime: '2026-05-04T05:00:00Z', durationMin: 20 }]);

        await repo.replaceForZone('zone-001', [entry], dayjs('2026-05-04'), 7.5, 'sched-default');

        expect(updateCalls).toHaveLength(1);
        expect(updateCalls[0]?.table).toBe(zones);
        expect(updateCalls[0]?.values).toEqual({ currentDepletionMm: 7.5 });
    });

    it('writes the depletion update even when the entries array is empty', async () => {
        const { db, updateCalls } = stubWriterDb();
        const repo = createScheduleEntriesRepository(db);

        await repo.replaceForZone('zone-002', [], dayjs('2026-05-04'), 12.3, 'sched-default');

        expect(updateCalls).toHaveLength(1);
        expect(updateCalls[0]?.values).toEqual({ currentDepletionMm: 12.3 });
    });

    it('persists sunriseAt as a JS Date on the schedule_entries insert', async () => {
        const { db, insertCalls } = stubWriterDb({ entries: ['entry-A'] });
        const repo = createScheduleEntriesRepository(db);
        const sunrise = dayjs('2026-05-04T11:30:00.000Z');
        const entry: IrrigationScheduleEntry = {
            ...buildEntry('2026-05-04', [{ startTime: '2026-05-04T05:00:00Z', durationMin: 20 }]),
            sunriseAt: sunrise,
        };

        await repo.replaceForZone('zone-001', [entry], dayjs('2026-05-04'), 0, 'sched-default');

        const entryInsert = insertCalls.find(c => c.table === scheduleEntries);
        expect(entryInsert?.rows[0]?.['sunriseAt']).toBeInstanceOf(Date);
        expect((entryInsert?.rows[0]?.['sunriseAt'] as Date).toISOString()).toBe(sunrise.toISOString());
    });

    it('persists sunriseAt as null when the planner entry omits it', async () => {
        const { db, insertCalls } = stubWriterDb({ entries: ['entry-A'] });
        const repo = createScheduleEntriesRepository(db);
        const entry = buildEntry('2026-05-04', [{ startTime: '2026-05-04T05:00:00Z', durationMin: 20 }]);

        await repo.replaceForZone('zone-001', [entry], dayjs('2026-05-04'), 0, 'sched-default');

        const entryInsert = insertCalls.find(c => c.table === scheduleEntries);
        expect(entryInsert?.rows[0]?.['sunriseAt']).toBeNull();
    });
});

describe('createScheduleEntriesRepository.loadFutureCycles', () => {
    it('returns mapped (cycle, zone) pairs with the runtime fields the caller needs', async () => {
        const row = buildFutureCycleRow({
            cycle: { id: 'cycle-future', durationMin: 30 },
            zone: { id: 'zone-future', name: 'Future Zone' },
            scheduleEntry: { date: '2026-05-07' },
        });
        const { db } = stubLoaderDb([row]);
        const repo = createScheduleEntriesRepository(db);

        const pairs = await repo.loadFutureCycles(NOW);

        expect(pairs).toHaveLength(1);
        expect(pairs[0]?.cycle.id).toBe('cycle-future');
        expect(pairs[0]?.cycle.durationMin).toBe(30);
        expect(pairs[0]?.cycle.entryDate).toBe('2026-05-07');
        expect(pairs[0]?.zone.id).toBe('zone-future');
        expect(pairs[0]?.zone.name).toBe('Future Zone');
    });

    it('builds the zone with site-fallback location when the zone has none', async () => {
        const row = buildFutureCycleRow({
            zone: { latitude: null, longitude: null },
            site: { latitude: 51.05, longitude: -114.07 },
        });
        const { db } = stubLoaderDb([row]);
        const repo = createScheduleEntriesRepository(db);

        const pairs = await repo.loadFutureCycles(NOW);

        expect(pairs[0]?.zone.location).toEqual({ lat: 51.05, lon: -114.07 });
    });

    it('passes the standard joined columns to db.select', async () => {
        const { db, getSelectColumns } = stubLoaderDb([]);
        const repo = createScheduleEntriesRepository(db);

        await repo.loadFutureCycles(NOW);

        const cols = getSelectColumns() as Record<string, unknown>;
        expect(cols['cycle']).toBe(irrigationCycles);
        expect(cols['scheduleEntry']).toBe(scheduleEntries);
        expect(cols['zone']).toBe(zones);
        expect(cols['grassType']).toBe(grassTypes);
        expect(cols['soilType']).toBe(soilTypes);
        expect(cols['site']).toBe(sites);
    });

    it('issues exactly one .where(...) call per invocation', async () => {
        const { db, whereCalls } = stubLoaderDb([buildFutureCycleRow()]);
        const repo = createScheduleEntriesRepository(db);

        await repo.loadFutureCycles(NOW);

        expect(whereCalls).toHaveLength(1);
    });

    it('returns an empty array when the query yields no rows', async () => {
        const { db } = stubLoaderDb([]);
        const repo = createScheduleEntriesRepository(db);

        const result = await repo.loadFutureCycles(NOW);

        expect(result).toEqual([]);
    });
});

describe('createScheduleEntriesRepository.loadInFlightCycles', () => {
    it('returns mapped (cycle, zone) pairs for in-flight rows', async () => {
        const row = buildFutureCycleRow({
            cycle: { id: 'cycle-running', firedAt: new Date('2026-05-04T11:00:00.000Z'), closedAt: null },
            zone: { id: 'zone-running' },
        });
        const { db } = stubLoaderDb([row]);
        const repo = createScheduleEntriesRepository(db);

        const pairs = await repo.loadInFlightCycles();

        expect(pairs).toHaveLength(1);
        expect(pairs[0]?.cycle.id).toBe('cycle-running');
        expect(pairs[0]?.zone.id).toBe('zone-running');
    });

    it('returns an empty array when there are no in-flight rows', async () => {
        const { db } = stubLoaderDb([]);
        const repo = createScheduleEntriesRepository(db);

        const result = await repo.loadInFlightCycles();

        expect(result).toEqual([]);
    });

    it('issues exactly one .where(...) call per invocation', async () => {
        const { db, whereCalls } = stubLoaderDb([buildFutureCycleRow()]);
        const repo = createScheduleEntriesRepository(db);

        await repo.loadInFlightCycles();

        expect(whereCalls).toHaveLength(1);
    });
});

describe('createScheduleEntriesRepository.markCycleFired', () => {
    it('issues a single UPDATE on irrigation_cycles with the firedAt value', async () => {
        const { db, updateCalls } = stubWriterDb();
        const repo = createScheduleEntriesRepository(db);
        const firedAt = new Date('2026-05-04T05:00:00.000Z');

        await repo.markCycleFired('cycle-X', firedAt);

        expect(updateCalls).toHaveLength(1);
        expect(updateCalls[0]?.table).toBe(irrigationCycles);
        expect(updateCalls[0]?.values).toEqual({ firedAt });
    });
});

describe('createScheduleEntriesRepository.markCycleClosed', () => {
    it('issues a single UPDATE on irrigation_cycles with the closedAt value', async () => {
        const { db, updateCalls } = stubWriterDb();
        const repo = createScheduleEntriesRepository(db);
        const closedAt = new Date('2026-05-04T05:30:00.000Z');

        await repo.markCycleClosed('cycle-Y', closedAt);

        expect(updateCalls).toHaveLength(1);
        expect(updateCalls[0]?.table).toBe(irrigationCycles);
        expect(updateCalls[0]?.values).toEqual({ closedAt });
    });
});

function stubNextRunDb(rows: NextRunJoinedRow[]): { db: Database; limits: number[] } {
    const limits: number[] = [];
    const runLimit = async (n: number): Promise<NextRunJoinedRow[]> => {
        limits.push(n);
        return rows;
    };
    const db = {
        select: () => ({
            from: () => ({ innerJoin: () => ({ leftJoin: () => ({ where: () => ({ orderBy: () => ({ limit: runLimit }) }) }) }) }),
        }),
    } as unknown as Database;
    return { db, limits };
}

function buildNextRunRow(overrides?: Partial<NextRunJoinedRow>): NextRunJoinedRow {
    return {
        entry: {
            id: 'entry-1',
            zoneId: 'zone-1',
            scheduleId: 'sched-1',
            date: '2026-05-22',
            appliedDepthMm: 5,
            depletionBeforeMm: 10,
            depletionAfterMm: 5,
            source: 'scheduled',
            sunriseAt: null,
            createdAt: NOW,
            updatedAt: NOW,
        },
        cycle: null,
        zone: { id: 'zone-1', name: 'North' },
        ...overrides,
    };
}

describe('createScheduleEntriesRepository.findScheduledFromDate', () => {
    it('returns the joined rows produced by the chain and forwards the limit', async () => {
        const seeded = [buildNextRunRow({ entry: { ...buildNextRunRow().entry, date: '2026-05-22' } })];
        const { db, limits } = stubNextRunDb(seeded);
        const repo = createScheduleEntriesRepository(db);

        const result = await repo.findScheduledFromDate('2026-05-22', 150);

        expect(result).toEqual(seeded);
        expect(limits).toEqual([150]);
    });

    it('returns an empty array when the join yields no rows', async () => {
        const { db } = stubNextRunDb([]);
        const repo = createScheduleEntriesRepository(db);

        const result = await repo.findScheduledFromDate('2026-05-22', 200);

        expect(result).toEqual([]);
    });
});
