import { describe, it, expect } from 'bun:test';
import {
    parseGrassTypes,
    parseSoilTypes,
    parseSites,
    parseZones,
} from '.';

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
