import { describe, expect, it } from 'bun:test';
import { systemState } from '@/db/schema';
import {
    loadSystemState,
    SYSTEM_STATE_SINGLETON_ID,
    upsertSystemState,
    type SystemStateReaderDb,
    type SystemStateRow,
    type SystemStateWriterDb,
} from '.';

function readerStub(rows: SystemStateRow[]): SystemStateReaderDb {
    return {
        select: () => ({
            from: () => ({
                where: () => ({
                    limit: async () => rows,
                }),
            }),
        }),
    };
}

type InsertCall = { values: Record<string, unknown>; conflictSet: Record<string, unknown> };

function writerStub(): { db: SystemStateWriterDb; calls: InsertCall[] } {
    const calls: InsertCall[] = [];
    const db: SystemStateWriterDb = {
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

describe('loadSystemState', () => {
    it('returns the singleton row when present', async () => {
        const since = new Date('2026-05-20T14:00:00.000Z');
        const db = readerStub([{ irrigationEnabled: true, since }]);

        const result = await loadSystemState(db);

        expect(result).toEqual({ irrigationEnabled: true, since });
    });

    it('returns the disabled state verbatim (Date stays a Date — no ISO conversion in the repo)', async () => {
        const since = new Date('2026-05-20T15:30:00.000Z');
        const db = readerStub([{ irrigationEnabled: false, since }]);

        const result = await loadSystemState(db);

        expect(result?.irrigationEnabled).toBe(false);
        expect(result?.since).toBeInstanceOf(Date);
        expect(result?.since.toISOString()).toBe('2026-05-20T15:30:00.000Z');
    });

    it('returns null when the singleton row is missing', async () => {
        const db = readerStub([]);

        const result = await loadSystemState(db);

        expect(result).toBeNull();
    });
});

describe('upsertSystemState', () => {
    it('inserts with the new flag, timestamp, and singleton id', async () => {
        const { db, calls } = writerStub();
        const now = new Date('2026-05-20T17:00:00.000Z');

        await upsertSystemState(db, false, now);

        expect(calls).toHaveLength(1);
        expect(calls[0]?.values).toMatchObject({
            id: SYSTEM_STATE_SINGLETON_ID,
            irrigationEnabled: false,
            since: now,
        });
    });

    it('configures onConflictDoUpdate to copy both columns from excluded', async () => {
        const { db, calls } = writerStub();

        await upsertSystemState(db, true, new Date('2026-05-21T10:00:00.000Z'));

        expect(calls[0]?.conflictSet).toHaveProperty('irrigationEnabled');
        expect(calls[0]?.conflictSet).toHaveProperty('since');
    });
});

// Keep the schema import alive when Drizzle tree-shakes the table ref.
void systemState;
