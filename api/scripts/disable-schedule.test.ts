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
} {
    const logs: string[] = [];
    const errors: string[] = [];
    const deps: DisableScheduleCliDeps = {
        disableSchedule: async () => null,
        loadDb: async () => ({} as ScheduleManagerDb),
        log: m => logs.push(m),
        error: m => errors.push(m),
        ...overrides,
    };
    return { deps, logs, errors };
}

describe('disableScheduleCli', () => {
    it('returns 0 and logs the deactivated schedule on success', async () => {
        const { deps, logs, errors } = recordingDeps({
            disableSchedule: async (_db, slug) => buildSchedule({ slug }),
        });

        const code = await disableScheduleCli(['bun', 'disable-schedule.ts', 'maintenance'], deps);

        expect(code).toBe(0);
        expect(logs[0]).toContain(`disabled 'maintenance'`);
        expect(errors).toEqual([]);
    });

    it('returns 1 with a usage error when the slug is missing from argv', async () => {
        let called = 0;
        const { deps, errors } = recordingDeps({
            disableSchedule: async () => { called += 1; return null; },
        });

        const code = await disableScheduleCli(['bun', 'disable-schedule.ts'], deps);

        expect(code).toBe(1);
        expect(errors[0]).toContain('usage');
        expect(called).toBe(0);
    });

    it('returns 1 with a clear error when the underlying call returns null', async () => {
        const { deps, errors } = recordingDeps({
            disableSchedule: async () => null,
        });

        const code = await disableScheduleCli(['bun', 'disable-schedule.ts', 'no-such'], deps);

        expect(code).toBe(1);
        expect(errors[0]).toContain(`no schedule with slug 'no-such'`);
    });
});
