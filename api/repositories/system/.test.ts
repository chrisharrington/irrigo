import { describe, expect, it } from 'bun:test';
import { systemState } from '@/db/schema';
import {
    createSystemStateRepository,
    SYSTEM_STATE_SINGLETON_ID,
    type SystemStateRepositoryDb,
    type SystemStateRow,
} from '.';

function stubReader(rows: SystemStateRow[]): SystemStateRepositoryDb {
    return {
        select: () => ({
            from: () => ({
                where: () => ({
                    limit: async () => rows,
                }),
            }),
        }),
        // Insert isn't exercised by reader tests; provide a no-op so the
        // composite type is satisfied.
        insert: () => ({
            values: () => ({
                onConflictDoUpdate: async () => undefined,
            }),
        }),
    };
}

type InsertCall = { values: Record<string, unknown>; conflictSet: Record<string, unknown> };

function stubWriter(): { db: SystemStateRepositoryDb; calls: InsertCall[] } {
    const calls: InsertCall[] = [];
    const db: SystemStateRepositoryDb = {
        select: () => ({
            from: () => ({
                where: () => ({
                    limit: async () => [],
                }),
            }),
        }),
        insert: () => ({
            values: (row) => ({
                onConflictDoUpdate: async ({ set }) => {
                    calls.push({ values: row, conflictSet: set });
                },
            }),
        }),
    };
    return { db, calls };
}

describe('createSystemStateRepository.findSingleton', () => {
    it('returns the singleton row when present', async () => {
        const since = new Date('2026-05-20T14:00:00.000Z');
        const repo = createSystemStateRepository(stubReader([{ irrigationEnabled: true, since }]));

        const result = await repo.findSingleton();

        expect(result).toEqual({ irrigationEnabled: true, since });
    });

    it('returns the disabled state verbatim (Date stays a Date — no ISO conversion in the repo)', async () => {
        const since = new Date('2026-05-20T15:30:00.000Z');
        const repo = createSystemStateRepository(stubReader([{ irrigationEnabled: false, since }]));

        const result = await repo.findSingleton();

        expect(result?.irrigationEnabled).toBe(false);
        expect(result?.since).toBeInstanceOf(Date);
        expect(result?.since.toISOString()).toBe('2026-05-20T15:30:00.000Z');
    });

    it('returns null when the singleton row is missing', async () => {
        const repo = createSystemStateRepository(stubReader([]));

        const result = await repo.findSingleton();

        expect(result).toBeNull();
    });
});

describe('createSystemStateRepository.upsertSingleton', () => {
    it('inserts with the new flag, timestamp, and singleton id', async () => {
        const { db, calls } = stubWriter();
        const repo = createSystemStateRepository(db);
        const now = new Date('2026-05-20T17:00:00.000Z');

        await repo.upsertSingleton(false, now);

        expect(calls).toHaveLength(1);
        expect(calls[0]?.values).toMatchObject({
            id: SYSTEM_STATE_SINGLETON_ID,
            irrigationEnabled: false,
            since: now,
        });
    });

    it('configures onConflictDoUpdate to copy both columns from excluded', async () => {
        const { db, calls } = stubWriter();
        const repo = createSystemStateRepository(db);

        await repo.upsertSingleton(true, new Date('2026-05-21T10:00:00.000Z'));

        expect(calls[0]?.conflictSet).toHaveProperty('irrigationEnabled');
        expect(calls[0]?.conflictSet).toHaveProperty('since');
    });
});

// Keep the schema import alive when Drizzle tree-shakes the table ref.
void systemState;
