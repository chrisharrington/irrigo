import { describe, expect, it } from 'bun:test';
import type { Database } from '@/db';
import { alerts } from '@/db/schema';
import { createAlertsRepository } from '.';

type AlertRow = typeof alerts.$inferSelect;

type SelectCall = { where: unknown; limit: number | null; ordered: boolean };
type InsertCall = { values: Record<string, unknown> };
type UpdateCall = { set: Record<string, unknown>; where: unknown };

const NOW = new Date('2026-05-20T12:00:00.000Z');

function buildRow(overrides?: Partial<AlertRow>): AlertRow {
    return {
        id: 'alert-001',
        class: 'ha-call-failed',
        tone: 'danger',
        title: 'HA close failed',
        sub: 'North · ECONNREFUSED',
        whenAt: NOW,
        zoneId: 'zone-001',
        ack: false,
        createdAt: NOW,
        updatedAt: NOW,
        ...overrides,
    };
}

function createStub(rows: AlertRow[]): {
    db: Database;
    selects: SelectCall[];
    inserts: InsertCall[];
    updates: UpdateCall[];
} {
    const selects: SelectCall[] = [];
    const inserts: InsertCall[] = [];
    const updates: UpdateCall[] = [];

    // Leaf handlers — the actual SELECT/INSERT/UPDATE logic. Lifting them out
    // keeps the Drizzle-mimicking chain wiring down to a single line per
    // operation in the `db` object.
    const runSelectWithOrderBy = async (cond: unknown): Promise<AlertRow[]> => {
        selects.push({ where: cond, limit: null, ordered: true });
        return rows;
    };

    const runSelectWithLimit = async (cond: unknown, limit: number): Promise<AlertRow[]> => {
        selects.push({ where: cond, limit, ordered: false });
        return rows.slice(0, limit);
    };

    const runSelectIdWithLimit = async (cond: unknown, limit: number): Promise<Array<{ id: string }>> => {
        selects.push({ where: cond, limit, ordered: false });
        return rows.slice(0, limit).map(r => ({ id: r.id }));
    };

    const runInsertValues = async (values: Record<string, unknown>): Promise<void> => {
        inserts.push({ values });
    };

    const runUpdateWhere = async (set: Record<string, unknown>, cond: unknown): Promise<void> => {
        updates.push({ set, where: cond });
    };

    const db = {
        select: (cols?: unknown) => ({
            from: () => ({
                where: (cond: unknown) => ({
                    orderBy: () => runSelectWithOrderBy(cond),
                    limit: (n: number) => (cols !== undefined ? runSelectIdWithLimit(cond, n) : runSelectWithLimit(cond, n)),
                }),
            }),
        }),
        insert: () => ({ values: runInsertValues }),
        update: () => ({ set: (set: Record<string, unknown>) => ({ where: (cond: unknown) => runUpdateWhere(set, cond) }) }),
    } as unknown as Database;

    return { db, selects, inserts, updates };
}

/** Walks a Drizzle condition tree and returns every Param value (string or boolean). */
function extractParamValues(cond: unknown): Array<string | boolean> {
    const seen = new WeakSet<object>();
    const values: Array<string | boolean> = [];
    function walk(node: unknown): void {
        if (typeof node !== 'object' || node === null) return;
        if (seen.has(node)) return;
        seen.add(node);
        const obj = node as Record<string, unknown>;
        if ('encoder' in obj && 'value' in obj) {
            const value = obj['value'];
            if (typeof value === 'string' || typeof value === 'boolean') {
                values.push(value);
                return;
            }
        }
        if (Array.isArray(node)) { for (const item of node) walk(item); return; }
        for (const value of Object.values(obj)) walk(value);
    }
    walk(cond);
    return values;
}

describe('createAlertsRepository.listUnacked', () => {
    it('returns each row mapped to its DTO', async () => {
        const a = buildRow({ id: 'a' });
        const b = buildRow({
            id: 'b',
            class: 'weather-stale',
            tone: 'warn',
            title: 'Weather API stale',
            sub: null,
            zoneId: null,
            whenAt: new Date('2026-05-20T11:00:00.000Z'),
        });
        const { db } = createStub([a, b]);
        const repo = createAlertsRepository(db);

        const result = await repo.listUnacked();

        expect(result).toHaveLength(2);
        expect(result[0]).toEqual({
            id: 'a',
            class: 'ha-call-failed',
            tone: 'danger',
            title: 'HA close failed',
            sub: 'North · ECONNREFUSED',
            when: '2026-05-20T12:00:00.000Z',
            zoneId: 'zone-001',
            ack: false,
        });
        expect(result[1]).toEqual({
            id: 'b',
            class: 'weather-stale',
            tone: 'warn',
            title: 'Weather API stale',
            sub: null,
            when: '2026-05-20T11:00:00.000Z',
            zoneId: null,
            ack: false,
        });
    });

    it('returns an empty array when there are no unacked alerts', async () => {
        const { db } = createStub([]);
        const repo = createAlertsRepository(db);

        const result = await repo.listUnacked();

        expect(result).toEqual([]);
    });

    it('filters by ack=false and orders by whenAt descending', async () => {
        const { db, selects } = createStub([]);
        const repo = createAlertsRepository(db);

        await repo.listUnacked();

        expect(selects).toHaveLength(1);
        expect(selects[0]?.ordered).toBe(true);
        const params = extractParamValues(selects[0]?.where);
        expect(params).toContain(false);
    });
});

describe('createAlertsRepository.findById', () => {
    it('returns the DTO when a row matches the id', async () => {
        const { db } = createStub([buildRow({ id: 'alert-xyz' })]);
        const repo = createAlertsRepository(db);

        const result = await repo.findById('alert-xyz');

        expect(result?.id).toBe('alert-xyz');
        expect(result?.ack).toBe(false);
    });

    it('returns null when no row matches', async () => {
        const { db } = createStub([]);
        const repo = createAlertsRepository(db);

        const result = await repo.findById('missing');

        expect(result).toBeNull();
    });

    it('limits the read to 1 row and queries by id', async () => {
        const { db, selects } = createStub([]);
        const repo = createAlertsRepository(db);

        await repo.findById('alert-xyz');

        expect(selects).toHaveLength(1);
        expect(selects[0]?.limit).toBe(1);
        const params = extractParamValues(selects[0]?.where);
        expect(params).toContain('alert-xyz');
    });
});

describe('createAlertsRepository.findUnackedByDedupKey', () => {
    it('returns the row id when a matching unacked row exists', async () => {
        const { db } = createStub([buildRow({ id: 'existing-001' })]);
        const repo = createAlertsRepository(db);

        const result = await repo.findUnackedByDedupKey('ha-call-failed', 'zone-001');

        expect(result).toEqual({ id: 'existing-001' });
    });

    it('returns null when no matching row exists', async () => {
        const { db } = createStub([]);
        const repo = createAlertsRepository(db);

        const result = await repo.findUnackedByDedupKey('ha-call-failed', 'zone-001');

        expect(result).toBeNull();
    });

    it('passes the class, ack=false, and zoneId through the WHERE clause', async () => {
        const { db, selects } = createStub([]);
        const repo = createAlertsRepository(db);

        await repo.findUnackedByDedupKey('ha-call-failed', 'zone-001');

        expect(selects).toHaveLength(1);
        expect(selects[0]?.limit).toBe(1);
        const params = extractParamValues(selects[0]?.where);
        expect(params).toContain('ha-call-failed');
        expect(params).toContain(false);
        expect(params).toContain('zone-001');
    });

    it('omits the zoneId param when zoneId is undefined (global alert)', async () => {
        const { db, selects } = createStub([]);
        const repo = createAlertsRepository(db);

        await repo.findUnackedByDedupKey('weather-stale', undefined);

        const params = extractParamValues(selects[0]?.where);
        expect(params).toContain('weather-stale');
        expect(params).not.toContain('zone-001');
    });
});

describe('createAlertsRepository.insertAlert', () => {
    it('writes the supplied class, tone, title, sub, and zoneId', async () => {
        const { db, inserts } = createStub([]);
        const repo = createAlertsRepository(db);

        await repo.insertAlert({
            class: 'ha-call-failed',
            tone: 'danger',
            title: 'HA close failed',
            sub: 'North · ECONNREFUSED',
            zoneId: 'zone-001',
        });

        expect(inserts).toHaveLength(1);
        expect(inserts[0]?.values).toEqual({
            class: 'ha-call-failed',
            tone: 'danger',
            title: 'HA close failed',
            sub: 'North · ECONNREFUSED',
            zoneId: 'zone-001',
        });
    });

    it('accepts null sub and zoneId for global alerts', async () => {
        const { db, inserts } = createStub([]);
        const repo = createAlertsRepository(db);

        await repo.insertAlert({
            class: 'weather-stale',
            tone: 'warn',
            title: 'Weather API stale',
            sub: null,
            zoneId: null,
        });

        expect(inserts[0]?.values).toEqual({
            class: 'weather-stale',
            tone: 'warn',
            title: 'Weather API stale',
            sub: null,
            zoneId: null,
        });
    });
});

describe('createAlertsRepository.updateAlert', () => {
    it('writes the supplied set values and matches by id', async () => {
        const { db, updates } = createStub([]);
        const repo = createAlertsRepository(db);

        await repo.updateAlert('alert-001', { title: 'New title', sub: 'New sub', tone: 'danger' });

        expect(updates).toHaveLength(1);
        expect(updates[0]?.set).toEqual({ title: 'New title', sub: 'New sub', tone: 'danger' });
        const params = extractParamValues(updates[0]?.where);
        expect(params).toContain('alert-001');
    });

    it('sets ack=true when called from the acknowledge path', async () => {
        const { db, updates } = createStub([]);
        const repo = createAlertsRepository(db);

        await repo.updateAlert('alert-001', { ack: true });

        expect(updates[0]?.set).toEqual({ ack: true });
    });
});

describe('createAlertsRepository.markAckedByClass', () => {
    it('sets ack=true with a where that filters by class and ack=false', async () => {
        const { db, updates } = createStub([]);
        const repo = createAlertsRepository(db);

        await repo.markAckedByClass('weather-stale');

        expect(updates).toHaveLength(1);
        expect(updates[0]?.set).toEqual({ ack: true });
        const params = extractParamValues(updates[0]?.where);
        expect(params).toContain('weather-stale');
        expect(params).toContain(false);
    });
});

// Keep schema imports alive when Drizzle tree-shakes the table refs.
void alerts;
