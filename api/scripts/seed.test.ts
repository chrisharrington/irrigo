import path from 'node:path';
import { describe, it, expect } from 'bun:test';
import { schedules, zones } from '@/db/schema';
import { computeInitialDepletionMm, seed, type SeedDb } from './seed';

const SEEDS_DIR = path.resolve(import.meta.dir, '../data/seeds');

function makeSeedDb() {
    const zoneConflictSets: Array<Record<string, unknown>> = [];
    const zoneInsertValues: Array<ReadonlyArray<Record<string, unknown>>> = [];
    const scheduleConflictSets: Array<Record<string, unknown>> = [];
    const scheduleInsertValues: Array<ReadonlyArray<Record<string, unknown>>> = [];

    const db: SeedDb = {
        insert: (table) => ({
            values: (rows) => ({
                onConflictDoUpdate: (config) => {
                    if (table === zones) {
                        zoneConflictSets.push(config.set as Record<string, unknown>);
                        zoneInsertValues.push(rows as ReadonlyArray<Record<string, unknown>>);
                    }
                    if (table === schedules) {
                        scheduleConflictSets.push(config.set as Record<string, unknown>);
                        scheduleInsertValues.push(rows as ReadonlyArray<Record<string, unknown>>);
                    }
                    return {
                        returning: async () =>
                            (rows as ReadonlyArray<Record<string, unknown>>).map((r, i) => ({
                                id: `id-${i}`,
                                slug: (r['slug'] as string) ?? `slug-${i}`,
                            })),
                    };
                },
            }),
        }),
    };

    return { db, zoneConflictSets, zoneInsertValues, scheduleConflictSets, scheduleInsertValues };
}

describe('computeInitialDepletionMm', () => {
    it('returns MAD when currentDepletionMm is not set', () => {
        // MAD = 0.3 * 165 * 0.5 = 24.75  (clay-loam AWC = 165 mm/m)
        const result = computeInitialDepletionMm(
            { rootDepthM: 0.3, allowableDepletionFraction: 0.5, currentDepletionMm: undefined },
            165,
        );
        expect(result).toBeCloseTo(24.75);
    });

    it('returns 0 when currentDepletionMm is explicitly 0', () => {
        const result = computeInitialDepletionMm(
            { rootDepthM: 0.3, allowableDepletionFraction: 0.5, currentDepletionMm: 0 },
            165,
        );
        expect(result).toBe(0);
    });

    it('returns the explicit value when currentDepletionMm is set to a positive number', () => {
        const result = computeInitialDepletionMm(
            { rootDepthM: 0.3, allowableDepletionFraction: 0.5, currentDepletionMm: 12.5 },
            165,
        );
        expect(result).toBe(12.5);
    });
});

describe('seed zone upsert', () => {
    it('seeds zones at MAD (not zero) when currentDepletionMm is absent from the JSON', async () => {
        const { db, zoneInsertValues } = makeSeedDb();

        await seed({ db, dataDir: SEEDS_DIR });

        const rows = zoneInsertValues[0];
        expect(rows).toBeDefined();
        for (const row of rows!) {
            expect(typeof row['currentDepletionMm']).toBe('number');
            expect(row['currentDepletionMm'] as number).toBeGreaterThan(0);
        }
    });

    it('does not include currentDepletionMm in the ON CONFLICT set (re-seed preserves operator state)', async () => {
        const { db, zoneConflictSets } = makeSeedDb();

        await seed({ db, dataDir: SEEDS_DIR });

        expect(zoneConflictSets).toHaveLength(1);
        expect('currentDepletionMm' in zoneConflictSets[0]!).toBe(false);
    });
});

describe('seed schedule upsert', () => {
    it('includes endBySunrise in schedule insert values', async () => {
        const { db, scheduleInsertValues } = makeSeedDb();

        await seed({ db, dataDir: SEEDS_DIR });

        const rows = scheduleInsertValues[0];
        expect(rows).toBeDefined();
        const maintenance = rows!.find(r => r['slug'] === 'maintenance');
        expect(maintenance).toBeDefined();
        expect(maintenance!['endBySunrise']).toBe(true);
    });

    it('does not include endBySunrise in the ON CONFLICT set (re-seed preserves operator edits)', async () => {
        const { db, scheduleConflictSets } = makeSeedDb();

        await seed({ db, dataDir: SEEDS_DIR });

        expect(scheduleConflictSets).toHaveLength(1);
        expect('endBySunrise' in scheduleConflictSets[0]!).toBe(false);
    });
});
