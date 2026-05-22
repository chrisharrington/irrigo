import { describe, expect, it } from 'bun:test';
import type { Database } from '@/db';
import { irrigationCycles, scheduleEntries, zones } from '@/db/schema';
import { createTonightRepository, type TonightJoinedRow } from '.';

type CaptureCall = { where: unknown; limit: number };

const NOW = new Date('2026-05-21T01:00:00.000Z');

function buildEntry(overrides?: Partial<typeof scheduleEntries.$inferSelect>): typeof scheduleEntries.$inferSelect {
    return {
        id: 'entry-1',
        zoneId: 'zone-1',
        scheduleId: 'sched-1',
        date: '2026-05-21',
        appliedDepthMm: 8.4,
        depletionBeforeMm: 12.0,
        depletionAfterMm: 0.3,
        source: 'scheduled',
        sunriseAt: new Date('2026-05-21T05:30:00.000Z'),
        sunsetAt: new Date('2026-05-20T20:30:00.000Z'),
        createdAt: NOW,
        updatedAt: NOW,
        ...overrides,
    };
}

function buildCycle(overrides?: Partial<typeof irrigationCycles.$inferSelect>): typeof irrigationCycles.$inferSelect {
    return {
        id: 'cycle-1',
        scheduleEntryId: 'entry-1',
        startTime: new Date('2026-05-21T03:00:00.000Z'),
        durationMin: 30,
        firedAt: null,
        closedAt: null,
        createdAt: NOW,
        updatedAt: NOW,
        ...overrides,
    };
}

function buildZone(overrides?: { id?: string; name?: string; slug?: string; patch?: string }): { id: string; name: string; slug: string; patch: string } {
    return { id: 'zone-1', name: 'North', slug: 'north', patch: 'a', ...overrides };
}

function createStub(rows: TonightJoinedRow[]): { db: Database; calls: CaptureCall[] } {
    const calls: CaptureCall[] = [];

    // Leaf handler — the actual query result. Lifting it out keeps the
    // Drizzle-mimicking chain wiring (`select().from().innerJoin().leftJoin()
    // .where().orderBy().limit()`) down to a single line in the `db` object.
    const runJoinedQuery = async (limit: number): Promise<TonightJoinedRow[]> => {
        const call = calls[calls.length - 1];
        if (call) call.limit = limit;
        return rows;
    };

    const captureWhere = (cond: unknown) => {
        calls.push({ where: cond, limit: -1 });
        return { orderBy: () => ({ limit: runJoinedQuery }) };
    };

    const db = {
        select: () => ({
            from: () => ({
                innerJoin: () => ({ leftJoin: () => ({ where: captureWhere }) }),
            }),
        }),
    } as unknown as Database;

    return { db, calls };
}

/** Walks a Drizzle condition tree and returns every string Param value. */
function extractParamValues(cond: unknown): string[] {
    const seen = new WeakSet<object>();
    const values: string[] = [];
    function walk(node: unknown): void {
        if (typeof node !== 'object' || node === null) return;
        if (seen.has(node)) return;
        seen.add(node);
        const obj = node as Record<string, unknown>;
        if ('encoder' in obj && 'value' in obj && typeof obj['value'] === 'string') {
            values.push(obj['value'] as string);
            return;
        }
        if (Array.isArray(node)) { for (const item of node) walk(item); return; }
        for (const value of Object.values(obj)) walk(value);
    }
    walk(cond);
    return values;
}

describe('createTonightRepository.findEntriesAfter', () => {
    it('returns the joined rows from the underlying query', async () => {
        const row: TonightJoinedRow = { entry: buildEntry(), cycle: buildCycle(), zone: buildZone() };
        const { db } = createStub([row]);
        const repo = createTonightRepository(db);

        const result = await repo.findEntriesAfter('2026-05-21');

        expect(result).toEqual([row]);
    });

    it('returns an empty array when no rows match', async () => {
        const { db } = createStub([]);
        const repo = createTonightRepository(db);

        const result = await repo.findEntriesAfter('2026-05-21');

        expect(result).toEqual([]);
    });

    it('forwards the cutoff date and the `scheduled` source filter to the WHERE clause', async () => {
        const { db, calls } = createStub([]);
        const repo = createTonightRepository(db);

        await repo.findEntriesAfter('2026-05-21');

        expect(calls).toHaveLength(1);
        const params = extractParamValues(calls[0]?.where);
        expect(params).toContain('2026-05-21');
        expect(params).toContain('scheduled');
    });

    it('caps the read at 200 rows', async () => {
        const { db, calls } = createStub([]);
        const repo = createTonightRepository(db);

        await repo.findEntriesAfter('2026-05-21');

        expect(calls[0]?.limit).toBe(200);
    });

    it('passes the exact cutoff date through to the predicate when called with a different value', async () => {
        const { db, calls } = createStub([]);
        const repo = createTonightRepository(db);

        await repo.findEntriesAfter('2027-01-15');

        const params = extractParamValues(calls[0]?.where);
        expect(params).toContain('2027-01-15');
    });

    it('preserves the cycle=null shape from the left-join when no cycles are materialised yet', async () => {
        const row: TonightJoinedRow = { entry: buildEntry(), cycle: null, zone: buildZone() };
        const { db } = createStub([row]);
        const repo = createTonightRepository(db);

        const result = await repo.findEntriesAfter('2026-05-21');

        expect(result[0]?.cycle).toBeNull();
    });
});

// Keep schema imports alive when Drizzle tree-shakes the table refs.
void scheduleEntries;
void irrigationCycles;
void zones;
