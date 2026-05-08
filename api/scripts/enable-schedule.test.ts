import { describe, it, expect } from 'bun:test';
import { enableScheduleCli, type EnableScheduleCliDeps } from './enable-schedule';
import type { Schedule, ScheduleManagerDb } from '@/daemon/schedule-manager';

const NOW = new Date('2026-05-08T12:00:00.000Z');

function buildSchedule(overrides?: Partial<Schedule>): Schedule {
    return {
        id: 'sched-1',
        siteId: 'site-A',
        slug: 'maintenance',
        name: 'Maintenance',
        isActive: true,
        createdAt: NOW,
        updatedAt: NOW,
        ...overrides,
    };
}

function recordingDeps(overrides: Partial<EnableScheduleCliDeps>): {
    deps: EnableScheduleCliDeps;
    logs: string[];
    errors: string[];
} {
    const logs: string[] = [];
    const errors: string[] = [];
    const deps: EnableScheduleCliDeps = {
        enableSchedule: async () => null,
        loadDb: async () => ({} as ScheduleManagerDb),
        log: m => logs.push(m),
        error: m => errors.push(m),
        ...overrides,
    };
    return { deps, logs, errors };
}

describe('enableScheduleCli', () => {
    it('returns 0 and logs the activated schedule on success', async () => {
        const { deps, logs, errors } = recordingDeps({
            enableSchedule: async (_db, slug) => buildSchedule({ slug, isActive: true }),
        });

        const code = await enableScheduleCli(['bun', 'enable-schedule.ts', 'maintenance'], deps);

        expect(code).toBe(0);
        expect(logs[0]).toContain(`enabled 'maintenance'`);
        expect(errors).toEqual([]);
    });

    it('returns 1 with a usage error when the slug is missing from argv', async () => {
        let called = 0;
        const { deps, errors } = recordingDeps({
            enableSchedule: async () => { called += 1; return null; },
        });

        const code = await enableScheduleCli(['bun', 'enable-schedule.ts'], deps);

        expect(code).toBe(1);
        expect(errors[0]).toContain('usage');
        expect(called).toBe(0);
    });

    it('returns 1 with a clear error when the underlying call returns null', async () => {
        const { deps, errors } = recordingDeps({
            enableSchedule: async () => null,
        });

        const code = await enableScheduleCli(['bun', 'enable-schedule.ts', 'no-such'], deps);

        expect(code).toBe(1);
        expect(errors[0]).toContain(`no schedule with slug 'no-such'`);
    });
});
