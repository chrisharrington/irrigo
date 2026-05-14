import { describe, it, expect } from 'bun:test';
import { nextRunsCli, type NextRun, type NextRunsCliDeps } from './next-runs';

function makeRun(overrides?: Partial<NextRun>): NextRun {
    return {
        zoneName: 'Front Lawn',
        zoneSlug: 'front-lawn',
        startTime: new Date('2026-05-13T05:30:00.000Z'),
        endTime: new Date('2026-05-13T05:45:00.000Z'),
        siteTimezone: 'UTC',
        ...overrides,
    };
}

function recordingDeps(overrides: Partial<NextRunsCliDeps>): {
    deps: NextRunsCliDeps;
    logs: string[];
    errors: string[];
} {
    const logs: string[] = [];
    const errors: string[] = [];
    const deps: NextRunsCliDeps = {
        loadRuns: async () => [],
        log: m => logs.push(m),
        error: m => errors.push(m),
        ...overrides,
    };
    return { deps, logs, errors };
}

describe('nextRunsCli', () => {
    it('returns 0 and logs header + formatted rows when runs are available', async () => {
        const run1 = makeRun({
            zoneName: 'Front Lawn',
            startTime: new Date('2026-05-13T05:30:00.000Z'),
            endTime: new Date('2026-05-13T05:45:00.000Z'),
        });
        const run2 = makeRun({
            zoneName: 'Back Garden',
            zoneSlug: 'back-garden',
            startTime: new Date('2026-05-13T06:00:00.000Z'),
            endTime: new Date('2026-05-13T06:20:00.000Z'),
        });
        const { deps, logs, errors } = recordingDeps({
            loadRuns: async () => [run1, run2],
        });

        const code = await nextRunsCli(deps);

        expect(code).toBe(0);
        expect(errors).toEqual([]);

        const header = logs[0]!;
        expect(header).toContain('Zone');
        expect(header).toContain('Start');
        expect(header).toContain('End');

        const row1 = logs[1]!;
        expect(row1).toContain('Front Lawn');
        expect(row1).toContain('Wed May 13, 2026 5:30am');
        expect(row1).toContain('Wed May 13, 2026 5:45am');

        const row2 = logs[2]!;
        expect(row2).toContain('Back Garden');
        expect(row2).toContain('Wed May 13, 2026 6:00am');
        expect(row2).toContain('Wed May 13, 2026 6:20am');

        expect(logs).toHaveLength(3);
    });

    it('returns 0 and logs all runs when multiple are available', async () => {
        const runs = Array.from({ length: 10 }, (_, i) =>
            makeRun({
                zoneName: `Zone ${i + 1}`,
                zoneSlug: `zone-${i + 1}`,
                startTime: new Date(Date.UTC(2026, 4, 13, i + 5)),
                endTime: new Date(Date.UTC(2026, 4, 13, i + 5, 15)),
            }),
        );
        const { deps, logs, errors } = recordingDeps({
            loadRuns: async () => runs,
        });

        const code = await nextRunsCli(deps);

        expect(code).toBe(0);
        expect(errors).toEqual([]);
        expect(logs).toHaveLength(11); // header + 10 rows
    });

    it('returns 0 and prints a no-runs message when zero cycles are returned', async () => {
        const { deps, logs, errors } = recordingDeps({
            loadRuns: async () => [],
        });

        const code = await nextRunsCli(deps);

        expect(code).toBe(0);
        expect(errors).toEqual([]);
        expect(logs).toHaveLength(1);
        expect(logs[0]).toContain('no upcoming scheduled irrigation cycles');
    });

    it('returns 1 and logs an error message when loadRuns rejects', async () => {
        const { deps, logs, errors } = recordingDeps({
            loadRuns: async () => { throw new Error('connection refused'); },
        });

        const code = await nextRunsCli(deps);

        expect(code).toBe(1);
        expect(logs).toEqual([]);
        expect(errors).toHaveLength(1);
        expect(errors[0]).toContain('failed to load upcoming cycles');
        expect(errors[0]).toContain('connection refused');
    });

    it('passes now to loadRuns without a limit', async () => {
        const calls: Array<{ now: Date }> = [];
        const { deps } = recordingDeps({
            loadRuns: async (now) => {
                calls.push({ now });
                return [];
            },
        });

        await nextRunsCli(deps);

        expect(calls).toHaveLength(1);
        expect(calls[0]!.now).toBeInstanceOf(Date);
    });

    it('formats times in the zone timezone, not UTC', async () => {
        const run = makeRun({
            startTime: new Date('2026-05-13T12:00:00.000Z'),
            endTime: new Date('2026-05-13T12:30:00.000Z'),
            siteTimezone: 'America/Edmonton', // UTC-6 in May
        });
        const { deps, logs } = recordingDeps({ loadRuns: async () => [run] });

        await nextRunsCli(deps);

        const row = logs[1]!;
        expect(row).toContain('6:00am');
        expect(row).not.toContain('12:00');
    });
});
