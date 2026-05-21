import { describe, expect, it } from 'bun:test';
import type { Database } from '@/db';
import { grassTypes, sites, soilTypes, zones } from '@/db/schema';
import type { LatestZoneFire } from '@/models/zone';
import {
    createZonesRepository,
    joinedRowToZone,
    mapJoinedRowsToZones,
    type SummaryJoinedRow,
    type ZoneJoinedRow,
} from '.';

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

type WhereCall = { conditions: unknown };

function buildJoinChainStub<TRow>(whereCalls: WhereCall[], rows: TRow[]) {
    const chain = {
        innerJoin: () => chain,
        where: (conditions: unknown) => {
            whereCalls.push({ conditions });
            return Promise.resolve(rows);
        },
    };
    return chain;
}

function stubLoaderDb(rows: ZoneJoinedRow[]): { db: Database; whereCalls: WhereCall[]; getSelectColumns: () => unknown } {
    const whereCalls: WhereCall[] = [];
    let selectColumns: unknown;
    const db = {
        select(columns: unknown) {
            selectColumns = columns;
            return { from: () => buildJoinChainStub(whereCalls, rows) };
        },
    } as unknown as Database;
    return { db, whereCalls, getSelectColumns: () => selectColumns };
}

function stubCountDb(rows: ReadonlyArray<{ total: number; enabled: number }>): Database {
    return {
        select() {
            return { from: () => Promise.resolve([...rows]) };
        },
    } as unknown as Database;
}

function stubSummaryJoinDb(rows: SummaryJoinedRow[]): { db: Database; getSelectColumns: () => unknown; whereCalls: WhereCall[] } {
    const whereCalls: WhereCall[] = [];
    let selectColumns: unknown;
    const db = {
        select(columns: unknown) {
            selectColumns = columns;
            return { from: () => buildJoinChainStub(whereCalls, rows) };
        },
    } as unknown as Database;
    return { db, whereCalls, getSelectColumns: () => selectColumns };
}

function stubLatestEntriesDb(rows: LatestZoneFire[]): { db: Database; onCalls: Array<ReadonlyArray<unknown>>; orderByCalls: Array<ReadonlyArray<unknown>> } {
    const onCalls: Array<ReadonlyArray<unknown>> = [];
    const orderByCalls: Array<ReadonlyArray<unknown>> = [];
    const db = {
        selectDistinctOn(on: ReadonlyArray<unknown>) {
            onCalls.push(on);
            return {
                from: () => ({
                    orderBy: (...exprs: ReadonlyArray<unknown>) => {
                        orderByCalls.push(exprs);
                        return Promise.resolve(rows);
                    },
                }),
            };
        },
    } as unknown as Database;
    return { db, onCalls, orderByCalls };
}

function summaryRow(overrides?: {
    zone?: Partial<SummaryJoinedRow['zone']>;
    grassType?: Partial<SummaryJoinedRow['grassType']>;
    soilType?: Partial<SummaryJoinedRow['soilType']>;
}): SummaryJoinedRow {
    const joined = buildJoinedRow({
        zone: overrides?.zone,
        grassType: overrides?.grassType,
        soilType: overrides?.soilType,
    });
    return { zone: joined.zone, grassType: joined.grassType, soilType: joined.soilType };
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

describe('joinedRowToZone', () => {
    it('returns the same shape as mapJoinedRowsToZones for a single enabled row', () => {
        const row = buildJoinedRow();

        const zone = joinedRowToZone(row);
        const fromArray = mapJoinedRowsToZones([row])[0];

        expect(zone).toEqual(fromArray!);
    });
});

describe('createZonesRepository.count', () => {
    it('returns total and enabled counts from the single returned row', async () => {
        const repo = createZonesRepository(stubCountDb([{ total: 5, enabled: 3 }]));

        const result = await repo.count();

        expect(result).toEqual({ total: 5, enabled: 3 });
    });

    it('defaults to zero counts when the query returns no rows', async () => {
        const repo = createZonesRepository(stubCountDb([]));

        const result = await repo.count();

        expect(result).toEqual({ total: 0, enabled: 0 });
    });
});

describe('createZonesRepository.loadEnabled', () => {
    it('returns mapped Zone models from the joined-row query', async () => {
        const row = buildJoinedRow({ zone: { id: 'returned-zone', name: 'Back Yard' } });
        const { db } = stubLoaderDb([row]);
        const repo = createZonesRepository(db);

        const result = await repo.loadEnabled();

        expect(result).toHaveLength(1);
        expect(result[0]?.id).toBe('returned-zone');
        expect(result[0]?.name).toBe('Back Yard');
    });

    it('passes the standard set of joined columns to db.select', async () => {
        const { db, getSelectColumns } = stubLoaderDb([]);
        const repo = createZonesRepository(db);

        await repo.loadEnabled();

        const cols = getSelectColumns() as Record<string, unknown>;
        expect(cols['zone']).toBe(zones);
        expect(cols['grassType']).toBe(grassTypes);
        expect(cols['soilType']).toBe(soilTypes);
        expect(cols['site']).toBe(sites);
    });

    it('issues exactly one .where(...) call per invocation', async () => {
        const { db, whereCalls } = stubLoaderDb([buildJoinedRow()]);
        const repo = createZonesRepository(db);

        await repo.loadEnabled();

        expect(whereCalls).toHaveLength(1);
    });

    it('returns an empty array when no zones match', async () => {
        const { db } = stubLoaderDb([]);
        const repo = createZonesRepository(db);

        const result = await repo.loadEnabled();

        expect(result).toEqual([]);
    });
});

describe('createZonesRepository.findById', () => {
    it('returns the mapped Zone when a row matches the id', async () => {
        const row = buildJoinedRow({ zone: { id: 'zone-target', name: 'Target Zone' } });
        const { db } = stubLoaderDb([row]);
        const repo = createZonesRepository(db);

        const result = await repo.findById('zone-target');

        expect(result).not.toBeNull();
        expect(result?.id).toBe('zone-target');
        expect(result?.name).toBe('Target Zone');
    });

    it('returns null when no row matches the id', async () => {
        const { db } = stubLoaderDb([]);
        const repo = createZonesRepository(db);

        const result = await repo.findById('zone-missing');

        expect(result).toBeNull();
    });
});

describe('createZonesRepository.loadJoinedRowsForSummary', () => {
    it('returns the rows produced by the chained join', async () => {
        const rows = [summaryRow({ zone: { id: 'a' } }), summaryRow({ zone: { id: 'b' } })];
        const { db } = stubSummaryJoinDb(rows);
        const repo = createZonesRepository(db);

        const result = await repo.loadJoinedRowsForSummary();

        expect(result.map(r => r.zone.id)).toEqual(['a', 'b']);
    });

    it('selects from zones with grass and soil columns', async () => {
        const { db, getSelectColumns } = stubSummaryJoinDb([]);
        const repo = createZonesRepository(db);

        await repo.loadJoinedRowsForSummary();

        const cols = getSelectColumns() as Record<string, unknown>;
        expect(cols['zone']).toBe(zones);
        expect(cols['grassType']).toBe(grassTypes);
        expect(cols['soilType']).toBe(soilTypes);
    });
});

describe('createZonesRepository.loadLatestScheduleEntries', () => {
    it('returns the rows produced by the distinct-on query', async () => {
        const entries: LatestZoneFire[] = [
            { zoneId: 'zone-1', date: '2026-05-13', appliedDepthMm: 14 },
            { zoneId: 'zone-2', date: '2026-05-12', appliedDepthMm: 9 },
        ];
        const { db } = stubLatestEntriesDb(entries);
        const repo = createZonesRepository(db);

        const result = await repo.loadLatestScheduleEntries();

        expect(result).toEqual(entries);
    });

    it('groups the distinct-on result by zoneId and orders descending by date', async () => {
        const { db, onCalls, orderByCalls } = stubLatestEntriesDb([]);
        const repo = createZonesRepository(db);

        await repo.loadLatestScheduleEntries();

        expect(onCalls).toHaveLength(1);
        expect(onCalls[0]).toHaveLength(1);
        expect(orderByCalls).toHaveLength(1);
        expect(orderByCalls[0]).toHaveLength(2);
    });
});
