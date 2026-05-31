import { describe, expect, it } from 'bun:test';
import dayjs from 'dayjs';
import type { Database } from '@/db';
import { schedulingDecisions } from '@/db/schema';
import {
    createSchedulingDecisionsRepository,
    DEFAULT_SCHEDULING_DECISION_RETENTION_DAYS,
    resolveSchedulingDecisionRetentionDays,
    type RecordSchedulingDecisionInput,
} from '.';

type InsertCall = { table: unknown; rows: unknown };
type DeleteCall = { table: unknown; condition: unknown };

/**
 * Recording-stub Drizzle client. `insert().values()` is awaitable;
 * `delete().where()` records the prune.
 */
function makeStub() {
    const inserts: InsertCall[] = [];
    const deletes: DeleteCall[] = [];
    const db = {
        insert: (table: unknown) => ({
            values: (rows: unknown) => {
                inserts.push({ table, rows });
                return Promise.resolve();
            },
        }),
        delete: (table: unknown) => ({
            where: (condition: unknown) => {
                deletes.push({ table, condition });
                return Promise.resolve();
            },
        }),
    } as unknown as Database;
    return { db, inserts, deletes };
}

/** Walks a Drizzle condition tree and returns the first Date value it carries. */
function findDate(node: unknown, seen = new WeakSet<object>()): Date | undefined {
    if (node instanceof Date) return node;
    if (typeof node !== 'object' || node === null) return undefined;
    if (seen.has(node)) return undefined;
    seen.add(node);
    for (const value of Object.values(node as Record<string, unknown>)) {
        const found = findDate(value, seen);
        if (found) return found;
    }
    return undefined;
}

const REPLAN_AT = new Date('2026-05-30T20:00:00.000Z');

const baseInput = (overrides?: Partial<RecordSchedulingDecisionInput>): RecordSchedulingDecisionInput => ({
    zoneId: 'zone-001',
    scheduleId: 'sched-001',
    date: '2026-05-30',
    replanAt: REPLAN_AT,
    outcome: 'skipped',
    reason: 'rain-forecast',
    depletionBeforeMm: 18.4,
    depletionAfterMm: 18.4,
    triggerThresholdMm: 15.0,
    weatherSnapshotId: 'snapshot-001',
    ...overrides,
});

describe('createSchedulingDecisionsRepository', () => {
    it('inserts a row carrying the decision, inputs, and snapshot reference', async () => {
        const { db, inserts } = makeStub();
        const repo = createSchedulingDecisionsRepository(db, 28);

        await repo.record(baseInput());

        const insert = inserts.find(c => c.table === schedulingDecisions);
        expect(insert).toBeDefined();
        expect(insert!.rows).toMatchObject({
            zoneId: 'zone-001',
            scheduleId: 'sched-001',
            date: '2026-05-30',
            replanAt: REPLAN_AT,
            outcome: 'skipped',
            reason: 'rain-forecast',
            depletionBeforeMm: 18.4,
            depletionAfterMm: 18.4,
            triggerThresholdMm: 15.0,
            weatherSnapshotId: 'snapshot-001',
        });
    });

    it('persists a null snapshot reference when the snapshot write failed', async () => {
        const { db, inserts } = makeStub();
        const repo = createSchedulingDecisionsRepository(db, 28);

        await repo.record(baseInput({ weatherSnapshotId: null }));

        const insert = inserts.find(c => c.table === schedulingDecisions);
        expect((insert!.rows as Record<string, unknown>)['weatherSnapshotId']).toBeNull();
    });

    it('prunes decisions older than the retention window, measured from the replan time', async () => {
        const { db, deletes } = makeStub();
        const repo = createSchedulingDecisionsRepository(db, 28);

        await repo.record(baseInput());

        const prune = deletes.find(c => c.table === schedulingDecisions);
        expect(prune).toBeDefined();
        const cutoff = findDate(prune!.condition);
        expect(cutoff).toEqual(dayjs(REPLAN_AT).subtract(28, 'day').toDate());
    });

    it('does not prune when retention is 0 (keep everything)', async () => {
        const { db, deletes } = makeStub();
        const repo = createSchedulingDecisionsRepository(db, 0);

        await repo.record(baseInput());

        expect(deletes).toHaveLength(0);
    });
});

describe('resolveSchedulingDecisionRetentionDays', () => {
    it('falls back to the default when unset', () => {
        expect(resolveSchedulingDecisionRetentionDays(undefined)).toBe(DEFAULT_SCHEDULING_DECISION_RETENTION_DAYS);
    });

    it('parses a positive integer', () => {
        expect(resolveSchedulingDecisionRetentionDays('14')).toBe(14);
    });

    it('accepts 0 to disable pruning', () => {
        expect(resolveSchedulingDecisionRetentionDays('0')).toBe(0);
    });

    it('falls back to the default on non-numeric input', () => {
        expect(resolveSchedulingDecisionRetentionDays('forever')).toBe(DEFAULT_SCHEDULING_DECISION_RETENTION_DAYS);
    });

    it('falls back to the default on a negative value', () => {
        expect(resolveSchedulingDecisionRetentionDays('-5')).toBe(DEFAULT_SCHEDULING_DECISION_RETENTION_DAYS);
    });
});
