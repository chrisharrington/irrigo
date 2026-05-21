import { describe, expect, it } from 'bun:test';
import type { Database } from '@/db';
import { systemState } from '@/db/schema';
import {
    createSystemStateRepository,
    SYSTEM_STATE_SINGLETON_ID,
    type SystemStateRow,
} from '.';

// The factory takes the real `Database` type; these stubs are partial mocks
// cast through `unknown` so test files don't need to model the full Drizzle
// surface. Only the chain methods the factory actually calls are stubbed.
function stubReader(rows: SystemStateRow[]): Database {
    return {
        select: () => ({
            from: () => ({
                where: () => ({
                    limit: async () => rows,
                }),
            }),
        }),
        insert: () => ({
            values: () => ({
                onConflictDoUpdate: async () => undefined,
            }),
        }),
    } as unknown as Database;
}

type InsertCall = { values: Record<string, unknown>; conflictSet: Record<string, unknown> };

function stubWriter(): { db: Database; calls: InsertCall[] } {
    const calls: InsertCall[] = [];
    const db = {
        select: () => ({
            from: () => ({
                where: () => ({
                    limit: async () => [],
                }),
            }),
        }),
        insert: () => ({
            values: (row: Record<string, unknown>) => ({
                onConflictDoUpdate: async ({ set }: { set: Record<string, unknown> }) => {
                    calls.push({ values: row, conflictSet: set });
                },
            }),
        }),
    } as unknown as Database;
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
