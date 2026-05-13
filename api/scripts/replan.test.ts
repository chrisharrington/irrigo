import { describe, it, expect } from 'bun:test';
import { replanCli, type ReplanCliDeps } from './replan';

function recordingDeps(overrides: Partial<ReplanCliDeps>): {
    deps: ReplanCliDeps;
    logs: string[];
    errors: string[];
} {
    const logs: string[] = [];
    const errors: string[] = [];
    const deps: ReplanCliDeps = {
        triggerReplan: async () => {},
        log: m => logs.push(m),
        error: m => errors.push(m),
        ...overrides,
    };
    return { deps, logs, errors };
}

describe('replanCli', () => {
    it('returns 0 and logs success when the replan request succeeds', async () => {
        let called = 0;
        const { deps, logs, errors } = recordingDeps({
            triggerReplan: async () => { called += 1; },
        });

        const code = await replanCli(deps);

        expect(code).toBe(0);
        expect(called).toBe(1);
        expect(logs.some(m => m.includes('re-plan triggered'))).toBe(true);
        expect(errors).toEqual([]);
    });

    it('returns 1 and logs the error message when the replan request fails', async () => {
        const { deps, logs, errors } = recordingDeps({
            triggerReplan: async () => { throw new Error('POST /replan failed: 503 Service Unavailable'); },
        });

        const code = await replanCli(deps);

        expect(code).toBe(1);
        expect(logs).toEqual([]);
        expect(errors[0]).toContain('503 Service Unavailable');
    });
});
