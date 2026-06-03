import path from 'node:path';
import { describe, it, expect } from 'bun:test';
import { schedules, zones } from '@/db/schema';
import { seed, type SeedDb } from '.';

const SEEDS_DIR = path.resolve(import.meta.dir, '../../data/seeds');

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

    it('includes the patch variant in zone insert values, sourced from the seed JSON', async () => {
        const { db, zoneInsertValues } = makeSeedDb();

        await seed({ db, dataDir: SEEDS_DIR });

        const rows = zoneInsertValues[0]!;
        const patches = rows.map(row => row['patch']);
        expect(patches).toEqual(['a', 'b', 'c']);
    });

    it('refreshes the patch column on ON CONFLICT so re-seed picks up JSON edits', async () => {
        const { db, zoneConflictSets } = makeSeedDb();

        await seed({ db, dataDir: SEEDS_DIR });

        expect('patch' in zoneConflictSets[0]!).toBe(true);
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
