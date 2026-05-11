import { describe, it, expect } from 'bun:test';
import { schedules } from '@/db/schema';
import {
    disableSchedule,
    enableSchedule,
    loadActiveSchedulesBySite,
    loadScheduleBySlug,
    type Schedule,
    type ScheduleManagerDb,
} from './schedule-manager';

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
        createdAt: NOW,
        updatedAt: NOW,
        ...overrides,
    };
}

function createStub(rowsByPredicate: Schedule[]) {
    const selectCalls: SelectCall[] = [];
    const updateCalls: UpdateCall[] = [];
    let rows: Schedule[] = [...rowsByPredicate];

    const db: ScheduleManagerDb = {
        select() {
            return {
                from() {
                    return {
                        where(cond: unknown) {
                            selectCalls.push({ where: cond });
                            const params = extractParamValues(cond);
                            // No params: probably an `eq(isActive, true)` filter (boolean param
                            // is encoded differently and not picked up as a string Param value).
                            // The real call site is loadActiveSchedulesBySite, which wants only
                            // active rows. Otherwise treat the param as a slug.
                            if (params.length === 0) {
                                return Promise.resolve(rows.filter(r => r.isActive).map(s => ({ schedule: s })));
                            }
                            const slug = params[0]!;
                            return Promise.resolve(rows.filter(r => r.slug === slug).map(s => ({ schedule: s })));
                        },
                    };
                },
            } as unknown as ReturnType<ScheduleManagerDb['select']>;
        },
        update() {
            return {
                set(values) {
                    return {
                        async where(cond) {
                            updateCalls.push({ values, where: cond });
                            // Apply mutation in-place so subsequent reads see it. We match
                            // by inspecting the bound Param values; the conditions targeting
                            // a single row carry the row id as a Param. The "deactivate
                            // siblings" condition uses (siteId == X AND id != target.id) — we
                            // detect it by the presence of two params, treating the second
                            // as the *exclude* id.
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
                            return Promise.resolve(undefined);
                        },
                    };
                },
            };
        },
        async transaction(cb) {
            return cb(db);
        },
    };

    return { db, selectCalls, updateCalls, getRows: () => [...rows] };
}

function extractParamValues(cond: unknown): string[] {
    // Drizzle's eq/ne/and conditions are SQL objects whose `queryChunks` array
    // contains `Param` instances; each Param exposes the bound value via `.value`
    // alongside an `encoder` property. We collect every Param's string value.
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

describe('loadActiveSchedulesBySite', () => {
    it('returns a Map<siteId, Schedule> for every active row', async () => {
        const a = buildSchedule({ id: 'sched-A', siteId: 'site-A', isActive: true });
        const b = buildSchedule({ id: 'sched-B', siteId: 'site-B', isActive: true });
        const inactive = buildSchedule({ id: 'sched-C', siteId: 'site-C', isActive: false });
        const { db } = createStub([a, b, inactive]);

        const result = await loadActiveSchedulesBySite(db);

        expect(result.size).toBe(2);
        expect(result.get('site-A')?.id).toBe('sched-A');
        expect(result.get('site-B')?.id).toBe('sched-B');
        expect(result.has('site-C')).toBe(false);
    });

    it('returns an empty map when no active rows exist', async () => {
        const { db } = createStub([buildSchedule({ isActive: false })]);

        const result = await loadActiveSchedulesBySite(db);

        expect(result.size).toBe(0);
    });
});

describe('loadScheduleBySlug', () => {
    it('returns the schedule matching the slug', async () => {
        const target = buildSchedule({ slug: 'overseeding' });
        const { db } = createStub([buildSchedule({ slug: 'maintenance' }), target]);

        const result = await loadScheduleBySlug(db, 'overseeding');

        expect(result?.slug).toBe('overseeding');
    });

    it('returns null when no schedule matches the slug', async () => {
        const { db } = createStub([buildSchedule({ slug: 'maintenance' })]);

        const result = await loadScheduleBySlug(db, 'no-such');

        expect(result).toBeNull();
    });
});

describe('enableSchedule', () => {
    it('returns null without writing when the slug is unknown', async () => {
        const { db, updateCalls } = createStub([buildSchedule({ slug: 'maintenance' })]);

        const result = await enableSchedule(db, 'unknown');

        expect(result).toBeNull();
        expect(updateCalls).toHaveLength(0);
    });

    it('deactivates siblings on the same site, then activates the target — both inside the transaction', async () => {
        const previouslyActive = buildSchedule({ id: 'sched-prev', siteId: 'site-A', slug: 'overseeding', isActive: true });
        const target = buildSchedule({ id: 'sched-target', siteId: 'site-A', slug: 'maintenance', isActive: false });
        const otherSite = buildSchedule({ id: 'sched-other', siteId: 'site-B', slug: 'maintenance', isActive: true });
        const { db, updateCalls, getRows } = createStub([previouslyActive, target, otherSite]);

        const result = await enableSchedule(db, 'maintenance');

        expect(result?.id).toBe('sched-target');
        expect(result?.isActive).toBe(true);
        // Two updates: deactivate siblings on the same site, then activate the target.
        expect(updateCalls).toHaveLength(2);
        expect(updateCalls[0]?.values).toEqual({ isActive: false });
        expect(updateCalls[1]?.values).toEqual({ isActive: true });
        // Final state: the previous sibling is now inactive, target is active.
        const rows = getRows();
        expect(rows.find(r => r.id === 'sched-prev')?.isActive).toBe(false);
        expect(rows.find(r => r.id === 'sched-target')?.isActive).toBe(true);
        // The other site's row was not touched by either update — its sibling-deactivate
        // condition required `siteId = site-A`.
        expect(rows.find(r => r.id === 'sched-other')?.isActive).toBe(true);
    });
});

describe('disableSchedule', () => {
    it(`writes isActive = false for the matching slug and returns the row`, async () => {
        const target = buildSchedule({ id: 'sched-1', slug: 'maintenance', isActive: true });
        const { db, updateCalls } = createStub([target]);

        const result = await disableSchedule(db, 'maintenance');

        expect(result?.id).toBe('sched-1');
        expect(result?.isActive).toBe(false);
        expect(updateCalls).toHaveLength(1);
        expect(updateCalls[0]?.values).toEqual({ isActive: false });
    });

    it('returns null without writing when the slug is unknown', async () => {
        const { db, updateCalls } = createStub([]);

        const result = await disableSchedule(db, 'no-such');

        expect(result).toBeNull();
        expect(updateCalls).toHaveLength(0);
    });
});

// Use schedules import so the test file compiles even if Drizzle doesn't tree-shake.
void schedules;
