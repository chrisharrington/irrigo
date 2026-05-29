import { describe, expect, it } from 'bun:test';
import { irrigationCycles, scheduleEntries, zones } from '@/db/schema';
import { decodeCursor, encodeCursor } from '@/util/cursor';
import {
    DEFAULT_ACTIVITY_LIMIT,
    listActivity,
    MAX_ACTIVITY_LIMIT,
    type ActivityDb,
} from '.';

type EntryRow = typeof scheduleEntries.$inferSelect;
type JoinedRow = {
    entry: EntryRow;
    zone: { id: string; name: string; slug: string };
    durationMin: number;
    startedAt: Date | null;
};

const NOW = new Date('2026-05-21T12:00:00.000Z');

function buildEntry(overrides?: Partial<EntryRow>): EntryRow {
    return {
        id: 'entry-1',
        zoneId: 'zone-1',
        scheduleId: 'sched-1',
        date: '2026-05-20',
        appliedDepthMm: 8.4,
        depletionBeforeMm: 12.0,
        depletionAfterMm: 0.6,
        source: 'scheduled',
        createdAt: NOW,
        updatedAt: NOW,
        ...overrides,
    };
}

function buildJoinedRow(overrides?: {
    entry?: Partial<EntryRow>;
    zone?: Partial<{ id: string; name: string; slug: string }>;
    durationMin?: number;
    startedAt?: Date | null;
}): JoinedRow {
    return {
        entry: buildEntry(overrides?.entry),
        zone: {
            id: 'zone-1',
            name: 'Front Lawn',
            slug: 'front-lawn',
            ...overrides?.zone,
        },
        durationMin: overrides?.durationMin ?? 0,
        startedAt: overrides?.startedAt !== undefined ? overrides.startedAt : new Date('2026-05-20T05:00:00.000Z'),
    };
}

type DbCall = {
    select: Record<string, unknown>;
    where: unknown;
    groupBy: ReadonlyArray<unknown>;
    orderBy: ReadonlyArray<unknown>;
    limit: number;
};

function recordingDb(rows: JoinedRow[]): { db: ActivityDb; calls: DbCall[] } {
    const calls: DbCall[] = [];
    const db: ActivityDb = {
        select: (cols) => ({
            from: () => ({
                innerJoin: () => ({
                    leftJoin: () => ({
                        where: (whereCond) => ({
                            groupBy: (...groupBy) => ({
                                orderBy: (...orderBy) => ({
                                    limit: async (n) => {
                                        calls.push({
                                            select: cols as unknown as Record<string, unknown>,
                                            where: whereCond,
                                            groupBy,
                                            orderBy,
                                            limit: n,
                                        });
                                        return rows.slice(0, n);
                                    },
                                }),
                            }),
                        }),
                    }),
                }),
            }),
        }),
    };
    return { db, calls };
}

describe('listActivity', () => {
    it('maps planner and manual entries to the right source DTO field', async () => {
        const rows: JoinedRow[] = [
            buildJoinedRow({ entry: { id: 'e-planner', source: 'scheduled' } }),
            buildJoinedRow({ entry: { id: 'e-manual', source: 'manual' } }),
        ];
        const { db } = recordingDb(rows);

        const result = await listActivity(db, { limit: 10 });

        expect(result.activity.map(a => ({ id: a.id, source: a.source }))).toEqual([
            { id: 'e-planner', source: 'planner' },
            { id: 'e-manual', source: 'manual' },
        ]);
    });

    it('forwards the joined zone fields and depletion values into the DTO', async () => {
        const { db } = recordingDb([
            buildJoinedRow({
                entry: { id: 'e-1', appliedDepthMm: 7.5, depletionBeforeMm: 11.2, depletionAfterMm: 0.3, date: '2026-05-19' },
                zone: { id: 'zone-7', name: 'Back Strip', slug: 'back-strip' },
                durationMin: 42,
                startedAt: new Date('2026-05-19T05:00:00.000Z'),
            }),
        ]);

        const { activity } = await listActivity(db, { limit: 10 });

        expect(activity[0]).toEqual({
            id: 'e-1',
            date: '2026-05-19',
            zone: { id: 'zone-7', name: 'Back Strip', slug: 'back-strip' },
            appliedDepthMm: 7.5,
            durationMin: 42,
            startedAt: '2026-05-19T05:00:00.000Z',
            depletionBeforeMm: 11.2,
            depletionAfterMm: 0.3,
            source: 'planner',
        });
    });

    it('serialises startedAt as an ISO string when the joined row carries a fired-at instant', async () => {
        const { db } = recordingDb([
            buildJoinedRow({ entry: { id: 'fired' }, startedAt: new Date('2026-05-20T03:14:15.000Z') }),
        ]);

        const { activity } = await listActivity(db, { limit: 10 });

        expect(activity[0]?.startedAt).toBe('2026-05-20T03:14:15.000Z');
    });

    it('serialises startedAt when the value comes from the planned start_time fallback', async () => {
        // Same JS path as `firedAt`, but the DB-side COALESCE picked the
        // planned `startTime`. Verifies the field flows through regardless of
        // upstream source.
        const { db } = recordingDb([
            buildJoinedRow({ entry: { id: 'unfired' }, startedAt: new Date('2026-05-20T11:00:00.000Z') }),
        ]);

        const { activity } = await listActivity(db, { limit: 10 });

        expect(activity[0]?.startedAt).toBe('2026-05-20T11:00:00.000Z');
    });

    it('emits startedAt: null when the entry has no associated cycles', async () => {
        const { db } = recordingDb([buildJoinedRow({ entry: { id: 'deferred' }, startedAt: null })]);

        const { activity } = await listActivity(db, { limit: 10 });

        expect(activity[0]?.startedAt).toBeNull();
    });

    it('returns durationMin = 0 when the entry has no associated cycles', async () => {
        const { db } = recordingDb([buildJoinedRow({ durationMin: 0 })]);

        const { activity } = await listActivity(db, { limit: 10 });

        expect(activity[0]?.durationMin).toBe(0);
    });

    it('orders rows by (date DESC, id DESC) — passes the right exprs to orderBy', async () => {
        const { db, calls } = recordingDb([buildJoinedRow()]);

        await listActivity(db, { limit: 10 });

        expect(calls).toHaveLength(1);
        expect(calls[0]?.orderBy).toHaveLength(2);
        // The exprs are Drizzle SQL objects whose internal `.column` references
        // back to scheduleEntries.date / .id. We check the count + that the
        // limit reaches the lister rather than peering inside the SQL AST.
        expect(calls[0]?.limit).toBe(11); // limit + 1 for peek-ahead
    });

    it('trims results to limit and emits nextCursor when a peek-ahead row exists', async () => {
        const rows: JoinedRow[] = [
            buildJoinedRow({ entry: { id: 'e-1', date: '2026-05-20' } }),
            buildJoinedRow({ entry: { id: 'e-2', date: '2026-05-19' } }),
            buildJoinedRow({ entry: { id: 'e-3', date: '2026-05-18' } }),
        ];
        const { db } = recordingDb(rows);

        const result = await listActivity(db, { limit: 2 });

        expect(result.activity).toHaveLength(2);
        expect(result.activity.map(a => a.id)).toEqual(['e-1', 'e-2']);
        // nextCursor encodes the LAST returned row's (date, id) — the peek-ahead
        // row stays on the next page.
        expect(result.nextCursor).not.toBeNull();
        expect(decodeCursor(result.nextCursor!)).toEqual({ date: '2026-05-19', id: 'e-2' });
    });

    it('returns nextCursor: null when the result is the final page', async () => {
        const rows: JoinedRow[] = [buildJoinedRow({ entry: { id: 'only' } })];
        const { db } = recordingDb(rows);

        const result = await listActivity(db, { limit: 10 });

        expect(result.activity).toHaveLength(1);
        expect(result.nextCursor).toBeNull();
    });

    it('returns an empty page with no nextCursor when the table is empty', async () => {
        const { db } = recordingDb([]);

        const result = await listActivity(db, { limit: 10 });

        expect(result.activity).toEqual([]);
        expect(result.nextCursor).toBeNull();
    });

    it('threads the zoneId filter into the WHERE clause', async () => {
        const { db, calls } = recordingDb([buildJoinedRow()]);

        await listActivity(db, { limit: 10, zoneId: 'zone-7' });

        expect(calls).toHaveLength(1);
        const params = paramValues(calls[0]?.where);
        expect(params).toContain('zone-7');
    });

    it('threads the decoded cursor (date, id) into the WHERE clause', async () => {
        const cursor = encodeCursor('2026-05-18', 'entry-cursor');
        const { db, calls } = recordingDb([buildJoinedRow()]);

        await listActivity(db, { limit: 10, cursor });

        expect(calls).toHaveLength(1);
        const params = paramValues(calls[0]?.where);
        expect(params).toContain('2026-05-18');
        expect(params).toContain('entry-cursor');
    });

    it('returns the lister-default page size when limit equals DEFAULT_ACTIVITY_LIMIT', async () => {
        const { db, calls } = recordingDb([]);

        await listActivity(db, { limit: DEFAULT_ACTIVITY_LIMIT });

        expect(calls[0]?.limit).toBe(DEFAULT_ACTIVITY_LIMIT + 1);
    });
});

function paramValues(cond: unknown): string[] {
    // Drizzle conditions are SQL objects whose `queryChunks` carry `Param`
    // instances with `.value`. We walk the tree to extract bound string values
    // (the only kind our lister threads through). This is the same pattern used
    // by the schedule-manager tests.
    const seen = new WeakSet<object>();
    const values: string[] = [];
    function walk(node: unknown): void {
        if (typeof node !== 'object' || node === null) return;
        if (seen.has(node)) return;
        seen.add(node);
        const obj = node as Record<string, unknown>;
        if ('encoder' in obj && 'value' in obj && typeof obj['value'] === 'string') {
            values.push(obj['value']);
            return;
        }
        if (Array.isArray(node)) { for (const item of node) walk(item); return; }
        for (const v of Object.values(obj)) walk(v);
    }
    walk(cond);
    return values;
}

// Ensure the table imports compile even if Drizzle tree-shakes the references.
void scheduleEntries;
void irrigationCycles;
void zones;
void MAX_ACTIVITY_LIMIT;
