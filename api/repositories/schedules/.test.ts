import { describe, expect, it } from 'bun:test';
import dayjs from 'dayjs';
import type { Database } from '@/db';
import { schedules } from '@/db/schema';
import { createSchedulesRepository, type Schedule } from '.';

type SelectCall = { where?: unknown };
type UpdateCall = { values: Partial<Schedule>; where: unknown };

const NOW = new Date('2026-05-08T12:00:00.000Z');

function buildSchedule(overrides?: Partial<Schedule>): Schedule {
    return {
        id: 'sched-001',
        siteId: 'site-A',
        slug: 'maintenance',
        name: 'Maintenance',
        isActive: true,
        allowedDays: null,
        allowedTimeWindows: null,
        rootDepthMOverride: null,
        allowableDepletionFractionOverride: null,
        endBySunrise: null,
        skippedNightDate: null,
        createdAt: NOW,
        updatedAt: NOW,
        ...overrides,
    };
}

function createStub(rowsByPredicate: Schedule[]) {
    const selectCalls: SelectCall[] = [];
    const updateCalls: UpdateCall[] = [];
    const rows: Schedule[] = [...rowsByPredicate];

    // Leaf handlers — the actual SELECT/UPDATE logic. Lifting them out keeps
    // the Drizzle-mimicking chain wiring (`select().from().where()` etc.) down
    // to a single line per operation in the `db` object.
    const runSelectWhere = async (cond: unknown): Promise<Array<{ schedule: Schedule }>> => {
        selectCalls.push({ where: cond });
        const params = extractParamValues(cond);
        if (params.length === 0) {
            // No string params. Distinguish `eq(isActive, true)` (has a boolean
            // Param node) from `sql\`true\`` (no Param nodes at all). The
            // former wants active-only rows; the latter wants every row.
            return hasAnyParam(cond)
                ? rows.filter(r => r.isActive).map(s => ({ schedule: s }))
                : rows.map(s => ({ schedule: s }));
        }
        const slug = params[0]!;
        return rows.filter(r => r.slug === slug).map(s => ({ schedule: s }));
    };

    const runUpdateWhere = async (values: Partial<Schedule>, cond: unknown): Promise<void> => {
        updateCalls.push({ values, where: cond });
        const params = extractParamValues(cond);
        for (const row of rows) {
            if (params.length === 1 && params[0] === row.id) {
                Object.assign(row, values);
            } else if (params.length === 2) {
                const [siteId, excludeId] = params;
                if (row.siteId === siteId && row.id !== excludeId) {
                    Object.assign(row, values);
                }
            }
        }
    };

    const db = {
        select: () => ({ from: () => ({ where: runSelectWhere }) }),
        update: () => ({ set: (values: Partial<Schedule>) => ({ where: (cond: unknown) => runUpdateWhere(values, cond) }) }),
        transaction: async <T>(cb: (tx: unknown) => Promise<T>): Promise<T> => cb(db),
    } as unknown as Database;

    return { db, selectCalls, updateCalls, getRows: () => [...rows] };
}

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

/** Returns true if the condition tree contains any Drizzle Param node (string or otherwise). */
function hasAnyParam(cond: unknown): boolean {
    const seen = new WeakSet<object>();
    let found = false;
    function walk(node: unknown): void {
        if (found) return;
        if (typeof node !== 'object' || node === null) return;
        if (seen.has(node)) return;
        seen.add(node);
        const obj = node as Record<string, unknown>;
        if ('encoder' in obj && 'value' in obj) { found = true; return; }
        if (Array.isArray(node)) { for (const item of node) walk(item); return; }
        for (const value of Object.values(obj)) walk(value);
    }
    walk(cond);
    return found;
}

describe('createSchedulesRepository.listAll', () => {
    it('returns every schedule in insertion order, regardless of active state', async () => {
        const a = buildSchedule({ id: 'sched-A', siteId: 'site-A', isActive: true });
        const b = buildSchedule({ id: 'sched-B', siteId: 'site-A', isActive: false });
        const c = buildSchedule({ id: 'sched-C', siteId: 'site-B', isActive: false });
        const { db } = createStub([a, b, c]);
        const repo = createSchedulesRepository(db);

        const result = await repo.listAll();

        expect(result.map(s => s.id)).toEqual(['sched-A', 'sched-B', 'sched-C']);
    });

    it('returns an empty array when the schedules table is empty', async () => {
        const { db } = createStub([]);
        const repo = createSchedulesRepository(db);

        const result = await repo.listAll();

        expect(result).toEqual([]);
    });
});

describe('createSchedulesRepository.loadActiveBySite', () => {
    it('returns a Map<siteId, Schedule> for every active row', async () => {
        const a = buildSchedule({ id: 'sched-A', siteId: 'site-A', isActive: true });
        const b = buildSchedule({ id: 'sched-B', siteId: 'site-B', isActive: true });
        const inactive = buildSchedule({ id: 'sched-C', siteId: 'site-C', isActive: false });
        const { db } = createStub([a, b, inactive]);
        const repo = createSchedulesRepository(db);

        const result = await repo.loadActiveBySite();

        expect(result.size).toBe(2);
        expect(result.get('site-A')?.id).toBe('sched-A');
        expect(result.get('site-B')?.id).toBe('sched-B');
        expect(result.has('site-C')).toBe(false);
    });

    it('returns an empty map when no active rows exist', async () => {
        const { db } = createStub([buildSchedule({ isActive: false })]);
        const repo = createSchedulesRepository(db);

        const result = await repo.loadActiveBySite();

        expect(result.size).toBe(0);
    });
});

describe('createSchedulesRepository.findBySlug', () => {
    it('returns the schedule matching the slug', async () => {
        const target = buildSchedule({ slug: 'overseeding' });
        const { db } = createStub([buildSchedule({ slug: 'maintenance' }), target]);
        const repo = createSchedulesRepository(db);

        const result = await repo.findBySlug('overseeding');

        expect(result?.slug).toBe('overseeding');
    });

    it('returns null when no schedule matches the slug', async () => {
        const { db } = createStub([buildSchedule({ slug: 'maintenance' })]);
        const repo = createSchedulesRepository(db);

        const result = await repo.findBySlug('no-such');

        expect(result).toBeNull();
    });
});

describe('createSchedulesRepository.enable', () => {
    it('returns null without writing when the slug is unknown', async () => {
        const { db, updateCalls } = createStub([buildSchedule({ slug: 'maintenance' })]);
        const repo = createSchedulesRepository(db);

        const result = await repo.enable('unknown');

        expect(result).toBeNull();
        expect(updateCalls).toHaveLength(0);
    });

    it('deactivates siblings on the same site, then activates the target — both inside the transaction', async () => {
        const previouslyActive = buildSchedule({ id: 'sched-prev', siteId: 'site-A', slug: 'overseeding', isActive: true });
        const target = buildSchedule({ id: 'sched-target', siteId: 'site-A', slug: 'maintenance', isActive: false });
        const otherSite = buildSchedule({ id: 'sched-other', siteId: 'site-B', slug: 'maintenance', isActive: true });
        const { db, updateCalls, getRows } = createStub([previouslyActive, target, otherSite]);
        const repo = createSchedulesRepository(db);

        const result = await repo.enable('maintenance');

        expect(result?.id).toBe('sched-target');
        expect(result?.isActive).toBe(true);
        expect(updateCalls).toHaveLength(2);
        expect(updateCalls[0]?.values).toEqual({ isActive: false });
        expect(updateCalls[1]?.values).toEqual({ isActive: true });
        const rows = getRows();
        expect(rows.find(r => r.id === 'sched-prev')?.isActive).toBe(false);
        expect(rows.find(r => r.id === 'sched-target')?.isActive).toBe(true);
        expect(rows.find(r => r.id === 'sched-other')?.isActive).toBe(true);
    });
});

describe('createSchedulesRepository.disable', () => {
    it(`writes isActive = false for the matching slug and returns the row`, async () => {
        const target = buildSchedule({ id: 'sched-1', slug: 'maintenance', isActive: true });
        const { db, updateCalls } = createStub([target]);
        const repo = createSchedulesRepository(db);

        const result = await repo.disable('maintenance');

        expect(result?.id).toBe('sched-1');
        expect(result?.isActive).toBe(false);
        expect(updateCalls).toHaveLength(1);
        expect(updateCalls[0]?.values).toEqual({ isActive: false });
    });

    it('returns null without writing when the slug is unknown', async () => {
        const { db, updateCalls } = createStub([]);
        const repo = createSchedulesRepository(db);

        const result = await repo.disable('no-such');

        expect(result).toBeNull();
        expect(updateCalls).toHaveLength(0);
    });
});

describe('createSchedulesRepository.skipActiveTonight', () => {
    it('sets skippedNightDate on the active schedule and returns the row', async () => {
        const active = buildSchedule({ id: 'sched-active', slug: 'maintenance', isActive: true, skippedNightDate: null });
        const { db, updateCalls, getRows } = createStub([active]);
        const repo = createSchedulesRepository(db);

        const result = await repo.skipActiveTonight(dayjs('2026-05-20'));

        expect(result?.id).toBe('sched-active');
        expect(result?.skippedNightDate).toBe('2026-05-20');
        expect(updateCalls).toHaveLength(1);
        expect(updateCalls[0]?.values).toEqual({ skippedNightDate: '2026-05-20' });
        expect(getRows().find(r => r.id === 'sched-active')?.skippedNightDate).toBe('2026-05-20');
    });

    it('returns null without writing when no schedule is active', async () => {
        const inactive = buildSchedule({ id: 'sched-1', isActive: false });
        const { db, updateCalls } = createStub([inactive]);
        const repo = createSchedulesRepository(db);

        const result = await repo.skipActiveTonight(dayjs('2026-05-20'));

        expect(result).toBeNull();
        expect(updateCalls).toHaveLength(0);
    });

    it('does not touch inactive rows on the same site', async () => {
        const active = buildSchedule({ id: 'sched-A', siteId: 'site-A', slug: 'maintenance', isActive: true });
        const inactive = buildSchedule({ id: 'sched-B', siteId: 'site-A', slug: 'overseeding', isActive: false });
        const { db, getRows } = createStub([active, inactive]);
        const repo = createSchedulesRepository(db);

        await repo.skipActiveTonight(dayjs('2026-05-20'));

        expect(getRows().find(r => r.id === 'sched-A')?.skippedNightDate).toBe('2026-05-20');
        expect(getRows().find(r => r.id === 'sched-B')?.skippedNightDate).toBeNull();
    });
});

describe('createSchedulesRepository.resumeActiveTonight', () => {
    it('clears skippedNightDate on the active schedule and returns the row', async () => {
        const active = buildSchedule({ id: 'sched-active', isActive: true, skippedNightDate: '2026-05-20' });
        const { db, updateCalls, getRows } = createStub([active]);
        const repo = createSchedulesRepository(db);

        const result = await repo.resumeActiveTonight();

        expect(result?.id).toBe('sched-active');
        expect(result?.skippedNightDate).toBeNull();
        expect(updateCalls).toHaveLength(1);
        expect(updateCalls[0]?.values).toEqual({ skippedNightDate: null });
        expect(getRows().find(r => r.id === 'sched-active')?.skippedNightDate).toBeNull();
    });

    it('is idempotent: returns the active row even when no marker is set', async () => {
        const active = buildSchedule({ id: 'sched-1', isActive: true, skippedNightDate: null });
        const { db, updateCalls } = createStub([active]);
        const repo = createSchedulesRepository(db);

        const result = await repo.resumeActiveTonight();

        expect(result?.id).toBe('sched-1');
        expect(result?.skippedNightDate).toBeNull();
        expect(updateCalls).toHaveLength(1);
    });

    it('returns null without writing when no schedule is active', async () => {
        const inactive = buildSchedule({ id: 'sched-1', isActive: false });
        const { db, updateCalls } = createStub([inactive]);
        const repo = createSchedulesRepository(db);

        const result = await repo.resumeActiveTonight();

        expect(result).toBeNull();
        expect(updateCalls).toHaveLength(0);
    });
});

describe('createSchedulesRepository.clearStaleSkipMarkers', () => {
    it('issues one UPDATE with skippedNightDate=null and the lt(today) predicate', async () => {
        const stale = buildSchedule({ id: 'sched-A', skippedNightDate: '2026-05-19' });
        const fresh = buildSchedule({ id: 'sched-B', skippedNightDate: '2026-05-20' });
        const { db, updateCalls } = createStub([stale, fresh]);
        const repo = createSchedulesRepository(db);

        await repo.clearStaleSkipMarkers(dayjs('2026-05-20'));

        expect(updateCalls).toHaveLength(1);
        expect(updateCalls[0]?.values).toEqual({ skippedNightDate: null });
    });

    it('issues the UPDATE even when no rows have a marker — Drizzle handles the empty match', async () => {
        const a = buildSchedule({ id: 'sched-A', skippedNightDate: null });
        const b = buildSchedule({ id: 'sched-B', skippedNightDate: null });
        const { db, updateCalls } = createStub([a, b]);
        const repo = createSchedulesRepository(db);

        await repo.clearStaleSkipMarkers(dayjs('2026-05-20'));

        expect(updateCalls).toHaveLength(1);
        expect(updateCalls[0]?.values).toEqual({ skippedNightDate: null });
    });
});

void schedules;
