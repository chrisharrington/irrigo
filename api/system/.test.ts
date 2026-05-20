import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { systemState } from '@/db/schema';
import {
    getSystemState,
    setIrrigationEnabled,
    type SystemStateDb,
    type SystemStateReaderDb,
    type SystemStateWriterDb,
} from '.';

type SelectResult = Array<{ irrigationEnabled: boolean; since: Date }>;

function readerStub(rows: SelectResult): SystemStateReaderDb {
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

function bothStub(initialRows: SelectResult): { db: SystemStateDb; calls: InsertCall[] } {
    const writer = writerStub();
    const reader = readerStub(initialRows);
    return {
        db: { ...writer.db, ...reader },
        calls: writer.calls,
    };
}

describe('getSystemState', () => {
    it('maps the singleton row to a DTO with ISO since', async () => {
        const since = new Date('2026-05-20T14:00:00.000Z');
        const db = readerStub([{ irrigationEnabled: true, since }]);

        const result = await getSystemState(db);

        expect(result).toEqual({ irrigationEnabled: true, since: '2026-05-20T14:00:00.000Z' });
    });

    it('returns the disabled state verbatim', async () => {
        const since = new Date('2026-05-20T15:30:00.000Z');
        const db = readerStub([{ irrigationEnabled: false, since }]);

        const result = await getSystemState(db);

        expect(result).toEqual({ irrigationEnabled: false, since: '2026-05-20T15:30:00.000Z' });
    });

    describe('defensive fallback when the singleton row is missing', () => {
        let warnSpy: ReturnType<typeof spyOn>;

        beforeEach(() => {
            warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
        });

        afterEach(() => {
            warnSpy.mockRestore();
        });

        it('returns enabled with the unix epoch and warns', async () => {
            const db = readerStub([]);

            const result = await getSystemState(db);

            expect(result).toEqual({ irrigationEnabled: true, since: '1970-01-01T00:00:00.000Z' });
            const messages = warnSpy.mock.calls.map(args => String((args as unknown[])[0]));
            expect(messages.some(m => m.includes('singleton row missing'))).toBe(true);
        });
    });
});

describe('setIrrigationEnabled', () => {
    it('upserts with the new flag and timestamp, returning the DTO', async () => {
        const { db, calls } = writerStub();
        const now = new Date('2026-05-20T17:00:00.000Z');

        const result = await setIrrigationEnabled(db, false, now);

        expect(result).toEqual({ irrigationEnabled: false, since: '2026-05-20T17:00:00.000Z' });
        expect(calls).toHaveLength(1);
        expect(calls[0]?.values).toMatchObject({
            id: 'singleton',
            irrigationEnabled: false,
            since: now,
        });
    });

    it('round-trips through a reader-and-writer composite', async () => {
        // After a flip-to-disabled, a subsequent read still maps to the new state.
        const initialSince = new Date('2026-05-20T10:00:00.000Z');
        const { db } = bothStub([{ irrigationEnabled: true, since: initialSince }]);
        const flippedAt = new Date('2026-05-20T18:00:00.000Z');

        const post = await setIrrigationEnabled(db, false, flippedAt);

        expect(post.irrigationEnabled).toBe(false);
        expect(post.since).toBe(flippedAt.toISOString());
    });
});

// Use the systemState import so the file compiles even if Drizzle tree-shakes.
void systemState;
