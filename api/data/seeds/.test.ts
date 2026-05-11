import path from 'node:path';
import { describe, it, expect } from 'bun:test';
import {
    parseGrassTypes,
    parseSchedules,
    parseSites,
    parseSoilTypes,
    parseZones,
} from '.';

const SEEDS_DIR = import.meta.dir;

async function readSeedJson(file: string): Promise<unknown> {
    return Bun.file(path.join(SEEDS_DIR, file)).json();
}

describe('parseGrassTypes', () => {
    it('parses a valid grass type entry', () => {
        const rows = parseGrassTypes([
            { slug: 'kentucky-bluegrass', name: 'Kentucky Bluegrass', cropCoefficient: 0.85 },
        ]);

        expect(rows).toHaveLength(1);
        expect(rows[0]).toEqual({ slug: 'kentucky-bluegrass', name: 'Kentucky Bluegrass', cropCoefficient: 0.85 });
    });

    it('rejects entries missing a required field', () => {
        expect(() => parseGrassTypes([{ slug: 'k-blue', name: 'Kentucky Bluegrass' }])).toThrow(/cropCoefficient/);
    });

    it('rejects entries where a numeric field has the wrong type', () => {
        expect(() => parseGrassTypes([
            { slug: 'k-blue', name: 'Kentucky Bluegrass', cropCoefficient: 'high' },
        ])).toThrow(/cropCoefficient/);
    });
});

describe('parseSoilTypes', () => {
    it('parses a valid soil type entry', () => {
        const rows = parseSoilTypes([
            {
                slug: 'loam',
                name: 'Loam',
                availableWaterHoldingCapacityMmPerM: 150,
                infiltrationRateMmPerHr: 25,
            },
        ]);

        expect(rows).toHaveLength(1);
        expect(rows[0]?.slug).toBe('loam');
    });

    it('rejects entries missing a required field', () => {
        expect(() => parseSoilTypes([
            { slug: 'loam', name: 'Loam', infiltrationRateMmPerHr: 25 },
        ])).toThrow(/availableWaterHoldingCapacityMmPerM/);
    });

    it('rejects entries where a numeric field has the wrong type', () => {
        expect(() => parseSoilTypes([
            {
                slug: 'loam',
                name: 'Loam',
                availableWaterHoldingCapacityMmPerM: 'lots',
                infiltrationRateMmPerHr: 25,
            },
        ])).toThrow(/availableWaterHoldingCapacityMmPerM/);
    });
});

describe('parseSites', () => {
    it('parses a valid site entry', () => {
        const rows = parseSites([
            {
                slug: 'home',
                name: 'Home',
                timezone: 'America/Edmonton',
                latitude: 51.05,
                longitude: -114.07,
            },
        ]);

        expect(rows).toHaveLength(1);
        expect(rows[0]?.timezone).toBe('America/Edmonton');
    });

    it('rejects entries missing a required field', () => {
        expect(() => parseSites([
            { slug: 'home', name: 'Home', latitude: 51.05, longitude: -114.07 },
        ])).toThrow(/timezone/);
    });

    it('rejects entries where a numeric field has the wrong type', () => {
        expect(() => parseSites([
            {
                slug: 'home',
                name: 'Home',
                timezone: 'America/Edmonton',
                latitude: 'fifty-one',
                longitude: -114.07,
            },
        ])).toThrow(/latitude/);
    });
});

describe('parseZones', () => {
    const validZone = {
        slug: 'front-lawn',
        name: 'Front Lawn',
        site: 'home',
        grassType: 'kentucky-bluegrass',
        soilType: 'loam',
        rootDepthM: 0.3,
        allowableDepletionFraction: 0.5,
        irrigationEfficiency: 0.8,
        flowRateLPerMin: 15,
        areaM2: 100,
    };

    it('parses a valid zone entry', () => {
        const rows = parseZones([validZone]);

        expect(rows).toHaveLength(1);
        expect(rows[0]?.site).toBe('home');
        expect(rows[0]?.grassType).toBe('kentucky-bluegrass');
        expect(rows[0]?.soilType).toBe('loam');
    });

    it('rejects entries missing a required field', () => {
        const { site: _site, ...incomplete } = validZone;

        expect(() => parseZones([incomplete])).toThrow(/site/);
    });

    it('rejects entries where a numeric field has the wrong type', () => {
        expect(() => parseZones([{ ...validZone, areaM2: 'big' }])).toThrow(/areaM2/);
    });
});

describe('grass-types.json fixture', () => {
    it('parses against the schema and includes the standard cool/warm-season set', async () => {
        const rows = parseGrassTypes(await readSeedJson('grass-types.json'));

        expect(rows.length).toBeGreaterThanOrEqual(8);

        const slugs = new Set(rows.map(row => row.slug));
        expect(slugs.has('kentucky-bluegrass')).toBe(true);
        expect(slugs.has('bermudagrass')).toBe(true);
    });
});

describe('soil-types.json fixture', () => {
    it('parses against the schema and includes the standard USDA texture classes', async () => {
        const rows = parseSoilTypes(await readSeedJson('soil-types.json'));

        expect(rows.length).toBeGreaterThanOrEqual(5);

        const slugs = new Set(rows.map(row => row.slug));
        expect(slugs.has('sand')).toBe(true);
        expect(slugs.has('loam')).toBe(true);
        expect(slugs.has('clay')).toBe(true);
    });
});

describe('sites.json fixture', () => {
    it('parses against the schema and includes the home site', async () => {
        const rows = parseSites(await readSeedJson('sites.json'));

        expect(rows.length).toBeGreaterThanOrEqual(1);

        const home = rows.find(row => row.slug === 'home');
        expect(home).toBeDefined();
        expect(home?.timezone).toMatch(/\//);
    });
});

describe('parseSchedules', () => {
    it('parses a well-formed entry with all fields set', () => {
        const rows = parseSchedules([
            {
                slug: 'maintenance',
                siteSlug: 'home',
                name: 'Maintenance',
                isActive: true,
                allowedDays: [3, 5, 7],
                allowedTimeWindows: [
                    { start: '00:00', end: '10:00' },
                    { start: '19:00', end: '23:59' },
                ],
            },
        ]);

        expect(rows).toHaveLength(1);
        expect(rows[0]).toEqual({
            slug: 'maintenance',
            siteSlug: 'home',
            name: 'Maintenance',
            isActive: true,
            allowedDays: [3, 5, 7],
            allowedTimeWindows: [
                { start: '00:00', end: '10:00' },
                { start: '19:00', end: '23:59' },
            ],
        });
    });

    it('accepts null values for allowedDays and allowedTimeWindows', () => {
        const rows = parseSchedules([
            {
                slug: 'maintenance',
                siteSlug: 'home',
                name: 'Maintenance',
                isActive: true,
                allowedDays: null,
                allowedTimeWindows: null,
            },
        ]);

        expect(rows[0]?.allowedDays).toBeNull();
        expect(rows[0]?.allowedTimeWindows).toBeNull();
    });

    it('rejects entries with an ISO weekday outside 1..7', () => {
        const base = {
            slug: 'maintenance',
            siteSlug: 'home',
            name: 'Maintenance',
            isActive: true,
            allowedTimeWindows: null,
        };

        expect(() => parseSchedules([{ ...base, allowedDays: [0] }])).toThrow();
        expect(() => parseSchedules([{ ...base, allowedDays: [8] }])).toThrow();
    });

    it('rejects allowedTimeWindows whose start or end is not HH:mm', () => {
        const base = {
            slug: 'maintenance',
            siteSlug: 'home',
            name: 'Maintenance',
            isActive: true,
            allowedDays: null,
        };

        expect(() => parseSchedules([{ ...base, allowedTimeWindows: [{ start: '5pm', end: '11pm' }] }])).toThrow();
        expect(() => parseSchedules([{ ...base, allowedTimeWindows: [{ start: '05:00' }] }])).toThrow();
    });

    it('rejects entries missing the required siteSlug field', () => {
        expect(() => parseSchedules([
            {
                slug: 'maintenance',
                name: 'Maintenance',
                isActive: true,
                allowedDays: null,
                allowedTimeWindows: null,
            },
        ])).toThrow(/siteSlug/);
    });
});

describe('zones.json fixture', () => {
    it('parses against the schema and resolves all cross-file slug references', async () => {
        const [zoneRows, grassRows, soilRows, siteRows] = await Promise.all([
            readSeedJson('zones.json').then(parseZones),
            readSeedJson('grass-types.json').then(parseGrassTypes),
            readSeedJson('soil-types.json').then(parseSoilTypes),
            readSeedJson('sites.json').then(parseSites),
        ]);

        expect(zoneRows).toHaveLength(3);

        const grassSlugs = new Set(grassRows.map(row => row.slug));
        const soilSlugs = new Set(soilRows.map(row => row.slug));
        const siteSlugs = new Set(siteRows.map(row => row.slug));

        for (const zone of zoneRows) {
            expect(siteSlugs.has(zone.site)).toBe(true);
            expect(grassSlugs.has(zone.grassType)).toBe(true);
            expect(soilSlugs.has(zone.soilType)).toBe(true);
        }

        const zoneSlugs = zoneRows.map(row => row.slug);
        expect(zoneSlugs).toEqual(['front-lawn', 'back-lawn', 'side-yard']);
    });
});
