import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { grassTypes, schedules, sites, soilTypes, zones } from '@/db/schema';
import { seed, type SeedDb } from './seed';

type InsertCall = {
    table: unknown;
    rows: ReadonlyArray<Record<string, unknown>>;
    conflictTarget: unknown;
    conflictSet: Record<string, unknown>;
};

function createStubDb() {
    const calls: InsertCall[] = [];
    const db: SeedDb = {
        insert(table) {
            return {
                values(rows) {
                    return {
                        onConflictDoUpdate({ target, set }) {
                            calls.push({ table, rows, conflictTarget: target, conflictSet: set });
                            return {
                                returning() {
                                    const inserted = rows.map(row => {
                                        const slug = row['slug'] as string;
                                        return { id: `id-${slug}`, slug };
                                    });
                                    return Promise.resolve(inserted);
                                },
                            };
                        },
                    };
                },
            };
        },
    };
    return { db, calls };
}

async function writeJson(dir: string, file: string, data: unknown) {
    await Bun.write(path.join(dir, file), JSON.stringify(data));
}

async function writeEmptySeedDir(dir: string) {
    await writeJson(dir, 'grass-types.json', []);
    await writeJson(dir, 'soil-types.json', []);
    await writeJson(dir, 'sites.json', []);
    await writeJson(dir, 'zones.json', []);
}

describe('seed orchestrator', () => {
    let dataDir: string;

    beforeEach(async () => {
        dataDir = await mkdtemp(path.join(os.tmpdir(), 'irrigo-seed-'));
    });

    afterEach(async () => {
        await rm(dataDir, { recursive: true, force: true });
    });

    it('upserts each table in dependency order: grass types, soil types, sites, zones', async () => {
        await writeJson(dataDir, 'grass-types.json', [
            { slug: 'k-blue', name: 'Kentucky Bluegrass', cropCoefficient: 0.85 },
        ]);
        await writeJson(dataDir, 'soil-types.json', [
            { slug: 'loam', name: 'Loam', availableWaterHoldingCapacityMmPerM: 150, infiltrationRateMmPerHr: 25 },
        ]);
        await writeJson(dataDir, 'sites.json', [
            { slug: 'home', name: 'Home', timezone: 'America/Edmonton', latitude: 51.05, longitude: -114.07 },
        ]);
        await writeJson(dataDir, 'zones.json', [
            {
                slug: 'front',
                name: 'Front Lawn',
                site: 'home',
                grassType: 'k-blue',
                soilType: 'loam',
                rootDepthM: 0.3,
                allowableDepletionFraction: 0.5,
                irrigationEfficiency: 0.8,
                flowRateLPerMin: 15,
                areaM2: 100,
            },
        ]);
        const { db, calls } = createStubDb();

        await seed({ db, dataDir });

        expect(calls.map(c => c.table)).toEqual([grassTypes, soilTypes, sites, zones, schedules]);
    });

    it('resolves zone slug references to FK ids using maps from prior upserts', async () => {
        await writeJson(dataDir, 'grass-types.json', [
            { slug: 'k-blue', name: 'Kentucky Bluegrass', cropCoefficient: 0.85 },
        ]);
        await writeJson(dataDir, 'soil-types.json', [
            { slug: 'loam', name: 'Loam', availableWaterHoldingCapacityMmPerM: 150, infiltrationRateMmPerHr: 25 },
        ]);
        await writeJson(dataDir, 'sites.json', [
            { slug: 'home', name: 'Home', timezone: 'America/Edmonton', latitude: 51.05, longitude: -114.07 },
        ]);
        await writeJson(dataDir, 'zones.json', [
            {
                slug: 'front',
                name: 'Front Lawn',
                site: 'home',
                grassType: 'k-blue',
                soilType: 'loam',
                rootDepthM: 0.3,
                allowableDepletionFraction: 0.5,
                irrigationEfficiency: 0.8,
                flowRateLPerMin: 15,
                areaM2: 100,
            },
        ]);
        const { db, calls } = createStubDb();

        await seed({ db, dataDir });

        const zoneCall = calls.find(c => c.table === zones);
        expect(zoneCall).toBeDefined();
        const insertedZone = zoneCall!.rows[0]!;
        expect(insertedZone['siteId']).toBe('id-home');
        expect(insertedZone['grassTypeId']).toBe('id-k-blue');
        expect(insertedZone['soilTypeId']).toBe('id-loam');
    });

    it('throws when a zone references an unknown slug and skips the zone insert', async () => {
        await writeJson(dataDir, 'grass-types.json', [
            { slug: 'k-blue', name: 'Kentucky Bluegrass', cropCoefficient: 0.85 },
        ]);
        await writeJson(dataDir, 'soil-types.json', [
            { slug: 'loam', name: 'Loam', availableWaterHoldingCapacityMmPerM: 150, infiltrationRateMmPerHr: 25 },
        ]);
        await writeJson(dataDir, 'sites.json', [
            { slug: 'home', name: 'Home', timezone: 'America/Edmonton', latitude: 51.05, longitude: -114.07 },
        ]);
        await writeJson(dataDir, 'zones.json', [
            {
                slug: 'front',
                name: 'Front Lawn',
                site: 'unknown-site',
                grassType: 'k-blue',
                soilType: 'loam',
                rootDepthM: 0.3,
                allowableDepletionFraction: 0.5,
                irrigationEfficiency: 0.8,
                flowRateLPerMin: 15,
                areaM2: 100,
            },
        ]);
        const { db, calls } = createStubDb();

        await expect(seed({ db, dataDir })).rejects.toThrow(/unknown site "unknown-site"/);

        expect(calls.find(c => c.table === zones)).toBeUndefined();
    });

    it('runs cleanly with no inserts when every seed file is an empty array', async () => {
        await writeEmptySeedDir(dataDir);
        const { db, calls } = createStubDb();

        const summary = await seed({ db, dataDir });

        expect(calls).toHaveLength(0);
        expect(summary).toEqual({ grassTypes: 0, soilTypes: 0, sites: 0, zones: 0, schedules: 0 });
    });

    it('reads from the dataDir argument rather than the default location', async () => {
        await writeJson(dataDir, 'grass-types.json', [
            { slug: 'from-custom-dir', name: 'Custom', cropCoefficient: 1.0 },
        ]);
        await writeJson(dataDir, 'soil-types.json', []);
        await writeJson(dataDir, 'sites.json', []);
        await writeJson(dataDir, 'zones.json', []);
        const { db, calls } = createStubDb();

        await seed({ db, dataDir });

        const grassCall = calls.find(c => c.table === grassTypes);
        expect(grassCall?.rows[0]?.['slug']).toBe('from-custom-dir');
    });

    it('throws when a zone references an unknown grassType and skips the zone insert', async () => {
        await writeJson(dataDir, 'grass-types.json', [
            { slug: 'k-blue', name: 'Kentucky Bluegrass', cropCoefficient: 0.85 },
        ]);
        await writeJson(dataDir, 'soil-types.json', [
            { slug: 'loam', name: 'Loam', availableWaterHoldingCapacityMmPerM: 150, infiltrationRateMmPerHr: 25 },
        ]);
        await writeJson(dataDir, 'sites.json', [
            { slug: 'home', name: 'Home', timezone: 'America/Edmonton', latitude: 51.05, longitude: -114.07 },
        ]);
        await writeJson(dataDir, 'zones.json', [
            {
                slug: 'front',
                name: 'Front Lawn',
                site: 'home',
                grassType: 'unknown-grass',
                soilType: 'loam',
                rootDepthM: 0.3,
                allowableDepletionFraction: 0.5,
                irrigationEfficiency: 0.8,
                flowRateLPerMin: 15,
                areaM2: 100,
            },
        ]);
        const { db, calls } = createStubDb();

        await expect(seed({ db, dataDir })).rejects.toThrow(/unknown grassType "unknown-grass"/);

        expect(calls.find(c => c.table === zones)).toBeUndefined();
    });

    it('throws when a zone references an unknown soilType and skips the zone insert', async () => {
        await writeJson(dataDir, 'grass-types.json', [
            { slug: 'k-blue', name: 'Kentucky Bluegrass', cropCoefficient: 0.85 },
        ]);
        await writeJson(dataDir, 'soil-types.json', [
            { slug: 'loam', name: 'Loam', availableWaterHoldingCapacityMmPerM: 150, infiltrationRateMmPerHr: 25 },
        ]);
        await writeJson(dataDir, 'sites.json', [
            { slug: 'home', name: 'Home', timezone: 'America/Edmonton', latitude: 51.05, longitude: -114.07 },
        ]);
        await writeJson(dataDir, 'zones.json', [
            {
                slug: 'front',
                name: 'Front Lawn',
                site: 'home',
                grassType: 'k-blue',
                soilType: 'unknown-soil',
                rootDepthM: 0.3,
                allowableDepletionFraction: 0.5,
                irrigationEfficiency: 0.8,
                flowRateLPerMin: 15,
                areaM2: 100,
            },
        ]);
        const { db, calls } = createStubDb();

        await expect(seed({ db, dataDir })).rejects.toThrow(/unknown soilType "unknown-soil"/);

        expect(calls.find(c => c.table === zones)).toBeUndefined();
    });

    it('returns a summary with the per-table counts that were upserted', async () => {
        await writeJson(dataDir, 'grass-types.json', [
            { slug: 'k-blue', name: 'Kentucky Bluegrass', cropCoefficient: 0.85 },
            { slug: 'tall-fescue', name: 'Tall Fescue', cropCoefficient: 0.8 },
        ]);
        await writeJson(dataDir, 'soil-types.json', [
            { slug: 'loam', name: 'Loam', availableWaterHoldingCapacityMmPerM: 150, infiltrationRateMmPerHr: 25 },
        ]);
        await writeJson(dataDir, 'sites.json', [
            { slug: 'home', name: 'Home', timezone: 'America/Edmonton', latitude: 51.05, longitude: -114.07 },
            { slug: 'cabin', name: 'Cabin', timezone: 'America/Edmonton', latitude: 52.0, longitude: -115.0 },
            { slug: 'office', name: 'Office', timezone: 'America/Edmonton', latitude: 51.1, longitude: -114.1 },
        ]);
        await writeJson(dataDir, 'zones.json', []);
        const { db } = createStubDb();

        const summary = await seed({ db, dataDir });

        expect(summary).toEqual({ grassTypes: 2, soilTypes: 1, sites: 3, zones: 0, schedules: 3 });
    });

    it('throws a clear error when a seed file is missing from dataDir', async () => {
        await writeJson(dataDir, 'grass-types.json', []);
        await writeJson(dataDir, 'soil-types.json', []);
        await writeJson(dataDir, 'sites.json', []);
        // Intentionally omit zones.json.
        const { db } = createStubDb();

        await expect(seed({ db, dataDir })).rejects.toThrow(/missing seed file .+zones\.json/);
    });

    it('upserts a Maintenance/maintenance schedule for every seeded site with isActive=true', async () => {
        await writeJson(dataDir, 'grass-types.json', []);
        await writeJson(dataDir, 'soil-types.json', []);
        await writeJson(dataDir, 'sites.json', [
            { slug: 'home', name: 'Home', timezone: 'America/Edmonton', latitude: 51.05, longitude: -114.07 },
            { slug: 'cabin', name: 'Cabin', timezone: 'America/Edmonton', latitude: 52.0, longitude: -114.0 },
        ]);
        await writeJson(dataDir, 'zones.json', []);
        const { db, calls } = createStubDb();

        const summary = await seed({ db, dataDir });

        expect(summary.schedules).toBe(2);
        const scheduleCall = calls.find(c => c.table === schedules);
        expect(scheduleCall).toBeDefined();
        expect(scheduleCall!.rows).toHaveLength(2);
        for (const row of scheduleCall!.rows) {
            expect(row['slug']).toBe('maintenance');
            expect(row['name']).toBe('Maintenance');
            expect(row['isActive']).toBe(true);
            expect(typeof row['siteId']).toBe('string');
        }
    });

    it('omits isActive from the conflict-update set so re-seeding does not flip a deactivated schedule', async () => {
        await writeJson(dataDir, 'grass-types.json', []);
        await writeJson(dataDir, 'soil-types.json', []);
        await writeJson(dataDir, 'sites.json', [
            { slug: 'home', name: 'Home', timezone: 'America/Edmonton', latitude: 51.05, longitude: -114.07 },
        ]);
        await writeJson(dataDir, 'zones.json', []);
        const { db, calls } = createStubDb();

        await seed({ db, dataDir });

        const scheduleCall = calls.find(c => c.table === schedules);
        expect(scheduleCall).toBeDefined();
        expect(Object.keys(scheduleCall!.conflictSet)).toEqual(['name']);
        expect('isActive' in scheduleCall!.conflictSet).toBe(false);
    });

    it('skips schedules upsert when no sites are seeded', async () => {
        await writeJson(dataDir, 'grass-types.json', []);
        await writeJson(dataDir, 'soil-types.json', []);
        await writeJson(dataDir, 'sites.json', []);
        await writeJson(dataDir, 'zones.json', []);
        const { db, calls } = createStubDb();

        const summary = await seed({ db, dataDir });

        expect(summary.schedules).toBe(0);
        expect(calls.find(c => c.table === schedules)).toBeUndefined();
    });
});

describe('seed orchestrator against real api/data/seeds fixtures', () => {
    const realDataDir = path.resolve(import.meta.dir, '../data/seeds');

    it('runs end-to-end without parse or unknown-slug errors and inserts the expected zones', async () => {
        const { db, calls } = createStubDb();

        const summary = await seed({ db, dataDir: realDataDir });

        expect(summary.grassTypes).toBeGreaterThanOrEqual(8);
        expect(summary.soilTypes).toBeGreaterThanOrEqual(5);
        expect(summary.sites).toBeGreaterThanOrEqual(1);
        expect(summary.zones).toBe(3);

        const zoneCall = calls.find(c => c.table === zones);
        expect(zoneCall).toBeDefined();
        for (const row of zoneCall!.rows) {
            expect(row['siteId']).toMatch(/^id-/);
            expect(row['grassTypeId']).toMatch(/^id-/);
            expect(row['soilTypeId']).toMatch(/^id-/);
        }
    });
});
