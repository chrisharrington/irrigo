import { describe, it, expect } from 'bun:test';
import { disableScheduleCli, type DisableScheduleCliDeps } from './disable-schedule';
import type { Schedule, ScheduleManagerDb } from '@/daemon/schedule-manager';

const NOW = new Date('2026-05-08T12:00:00.000Z');

function buildSchedule(overrides?: Partial<Schedule>): Schedule {
    return {
        id: 'sched-1',
        siteId: 'site-A',
        slug: 'maintenance',
        name: 'Maintenance',
        isActive: false,
        allowedDays: null,
        allowedTimeWindows: null,
        rootDepthMOverride: null,
        allowableDepletionFractionOverride: null,
        createdAt: NOW,
        updatedAt: NOW,
        ...overrides,
    };
}

function recordingDeps(overrides: Partial<DisableScheduleCliDeps>): {
    deps: DisableScheduleCliDeps;
    logs: string[];
    errors: string[];
    replanCalls: { count: number };
} {
    const logs: string[] = [];
    const errors: string[] = [];
    const replanCalls = { count: 0 };
    const deps: DisableScheduleCliDeps = {
        disableSchedule: async () => null,
        loadDb: async () => ({} as ScheduleManagerDb),
        triggerReplan: async () => { replanCalls.count += 1; },
        log: m => logs.push(m),
        error: m => errors.push(m),
        ...overrides,
    };
    return { deps, logs, errors, replanCalls };
}

describe('disableScheduleCli', () => {
    it('returns 0, logs the deactivated schedule, and triggers a re-plan on success', async () => {
        const callOrder: string[] = [];
        const { deps, logs, errors, replanCalls } = recordingDeps({
            disableSchedule: async (_db, slug) => { callOrder.push('disable'); return buildSchedule({ slug }); },
            triggerReplan: async () => { callOrder.push('replan'); replanCalls.count += 1; },
        });

        const code = await disableScheduleCli(['bun', 'disable-schedule.ts', 'maintenance'], deps);

        expect(code).toBe(0);
        expect(logs.some(m => m.includes(`disabled 'maintenance'`))).toBe(true);
        expect(logs.some(m => m.includes('re-plan triggered'))).toBe(true);
        expect(errors).toEqual([]);
        expect(replanCalls.count).toBe(1);
        expect(callOrder).toEqual(['disable', 'replan']);
    });

    it('returns 1 with a usage error when the slug is missing from argv', async () => {
        let called = 0;
        const { deps, errors, replanCalls } = recordingDeps({
            disableSchedule: async () => { called += 1; return null; },
        });

        const code = await disableScheduleCli(['bun', 'disable-schedule.ts'], deps);

        expect(code).toBe(1);
        expect(errors[0]).toContain('usage');
        expect(called).toBe(0);
        expect(replanCalls.count).toBe(0);
    });

    it('returns 1 with a clear error when the underlying call returns null, never triggers a re-plan', async () => {
        const { deps, errors, replanCalls } = recordingDeps({
            disableSchedule: async () => null,
        });

        const code = await disableScheduleCli(['bun', 'disable-schedule.ts', 'no-such'], deps);

        expect(code).toBe(1);
        expect(errors[0]).toContain(`no schedule with slug 'no-such'`);
        expect(replanCalls.count).toBe(0);
    });

    it('returns 1 with a clear error when triggerReplan rejects after a successful DB write', async () => {
        const { deps, logs, errors } = recordingDeps({
            disableSchedule: async (_db, slug) => buildSchedule({ slug }),
            triggerReplan: async () => { throw new Error('POST /replan failed: 502 Bad Gateway'); },
        });

        const code = await disableScheduleCli(['bun', 'disable-schedule.ts', 'maintenance'], deps);

        expect(code).toBe(1);
        expect(logs.some(m => m.includes(`disabled 'maintenance'`))).toBe(true);
        expect(errors[0]).toContain('re-plan request failed');
        expect(errors[0]).toContain('already persisted');
        expect(errors[0]).toContain('502 Bad Gateway');
    });
});
