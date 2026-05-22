import { describe, expect, it } from 'bun:test';
import type { Database } from '@/db';
import { pushTokens } from '@/db/schema';
import { createPushTokensRepository, type PushToken } from '.';

type InsertCall = { values: Record<string, unknown>; conflictTarget: unknown; conflictSet: Record<string, unknown> };
type DeleteCall = { cond: unknown };

const NOW = new Date('2026-05-22T12:00:00.000Z');

function buildRow(overrides?: Partial<PushToken>): PushToken {
    return {
        id: 'pt-001',
        token: 'ExponentPushToken[abc]',
        platform: 'ios',
        userAgent: 'irrigo/1.0 iOS 17',
        createdAt: NOW,
        updatedAt: NOW,
        ...overrides,
    };
}

function createStub(rows: PushToken[]): {
    db: Database;
    inserts: InsertCall[];
    deletes: DeleteCall[];
    getRows: () => PushToken[];
} {
    const inserts: InsertCall[] = [];
    const deletes: DeleteCall[] = [];
    const currentRows: PushToken[] = [...rows];

    // Leaf handlers — the actual INSERT / DELETE / SELECT logic. Lifting them
    // out keeps the Drizzle-mimicking chain wiring down to a single line per
    // operation in the `db` object.
    const runInsertOnConflict = async (
        values: Record<string, unknown>,
        target: unknown,
        set: Record<string, unknown>,
    ): Promise<void> => {
        inserts.push({ values, conflictTarget: target, conflictSet: set });
    };

    const runDeleteWhere = async (cond: unknown): Promise<void> => {
        deletes.push({ cond });
    };

    const runSelectOrderBy = async (): Promise<PushToken[]> => currentRows;

    const db = {
        insert: () => ({
            values: (values: Record<string, unknown>) => ({
                onConflictDoUpdate: ({ target, set }: { target: unknown; set: Record<string, unknown> }) =>
                    runInsertOnConflict(values, target, set),
            }),
        }),
        delete: () => ({ where: runDeleteWhere }),
        select: () => ({ from: () => ({ orderBy: runSelectOrderBy }) }),
    } as unknown as Database;

    return { db, inserts, deletes, getRows: () => [...currentRows] };
}

describe('createPushTokensRepository.upsertByToken', () => {
    it('inserts with the supplied token, platform, and userAgent', async () => {
        const { db, inserts } = createStub([]);
        const repo = createPushTokensRepository(db);

        await repo.upsertByToken({ token: 'tok-1', platform: 'ios', userAgent: 'irrigo/1.0' });

        expect(inserts).toHaveLength(1);
        expect(inserts[0]?.values).toEqual({ token: 'tok-1', platform: 'ios', userAgent: 'irrigo/1.0' });
    });

    it('passes a null userAgent through to the insert values', async () => {
        const { db, inserts } = createStub([]);
        const repo = createPushTokensRepository(db);

        await repo.upsertByToken({ token: 'tok-2', platform: 'android', userAgent: null });

        expect(inserts[0]?.values).toEqual({ token: 'tok-2', platform: 'android', userAgent: null });
    });

    it('configures onConflictDoUpdate to refresh platform, userAgent, and updatedAt', async () => {
        const { db, inserts } = createStub([]);
        const repo = createPushTokensRepository(db);

        await repo.upsertByToken({ token: 'tok-3', platform: 'ios', userAgent: null });

        expect(inserts[0]?.conflictSet).toHaveProperty('platform');
        expect(inserts[0]?.conflictSet).toHaveProperty('userAgent');
        expect(inserts[0]?.conflictSet).toHaveProperty('updatedAt');
    });

    it('targets the token column for conflict resolution', async () => {
        const { db, inserts } = createStub([]);
        const repo = createPushTokensRepository(db);

        await repo.upsertByToken({ token: 'tok-4', platform: 'ios', userAgent: null });

        // Drizzle column refs are object references — comparing by identity to
        // the schema's token column is the cleanest assertion.
        expect(inserts[0]?.conflictTarget).toBe(pushTokens.token);
    });
});

describe('createPushTokensRepository.deleteByToken', () => {
    it('issues a delete with a where condition referencing the token argument', async () => {
        const { db, deletes } = createStub([buildRow({ token: 'tok-5' })]);
        const repo = createPushTokensRepository(db);

        await repo.deleteByToken('tok-5');

        expect(deletes).toHaveLength(1);
        // The condition tree carries the string param; walk for it.
        const params = extractParamValues(deletes[0]?.cond);
        expect(params).toContain('tok-5');
    });

    it('resolves without error when no row matches (no-op delete)', async () => {
        const { db, deletes } = createStub([]);
        const repo = createPushTokensRepository(db);

        await expect(repo.deleteByToken('nonexistent')).resolves.toBeUndefined();
        expect(deletes).toHaveLength(1);
    });
});

describe('createPushTokensRepository.listAll', () => {
    it('returns every row from the underlying select', async () => {
        const a = buildRow({ id: 'pt-A', token: 'tok-A' });
        const b = buildRow({ id: 'pt-B', token: 'tok-B', platform: 'android' });
        const { db } = createStub([a, b]);
        const repo = createPushTokensRepository(db);

        const result = await repo.listAll();

        expect(result.map(r => r.id)).toEqual(['pt-A', 'pt-B']);
    });

    it('returns an empty array when there are no registered tokens', async () => {
        const { db } = createStub([]);
        const repo = createPushTokensRepository(db);

        const result = await repo.listAll();

        expect(result).toEqual([]);
    });
});

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

void pushTokens;
