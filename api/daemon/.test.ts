import { describe, it, expect } from 'bun:test';
import { grassTypes, sites, soilTypes, zones } from '@/db/schema';
import {
    loadEnabledZones,
    mapJoinedRowsToZones,
    type ZoneJoinedRow,
    type ZoneLoaderDb,
} from './zones';

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
