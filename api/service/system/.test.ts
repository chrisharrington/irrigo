import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import type { SystemStateRepository } from '@/repositories/system';
import { getSystemState, setIrrigationEnabled } from '.';

function buildRepo(overrides?: Partial<SystemStateRepository>): SystemStateRepository {
    return {
        findSingleton: async () => null,
        upsertSingleton: async () => {},
        ...overrides,
    };
}

describe('getSystemState', () => {
    it('maps the loaded row to a DTO with ISO since', async () => {
        const since = new Date('2026-05-20T14:00:00.000Z');
        const repo = buildRepo({
            findSingleton: async () => ({ irrigationEnabled: true, since }),
        });

        const result = await getSystemState(repo);

        expect(result).toEqual({ irrigationEnabled: true, since: '2026-05-20T14:00:00.000Z' });
    });

    it('passes through the disabled state with ISO since', async () => {
        const since = new Date('2026-05-20T15:30:00.000Z');
        const repo = buildRepo({
            findSingleton: async () => ({ irrigationEnabled: false, since }),
        });

        const result = await getSystemState(repo);

        expect(result).toEqual({ irrigationEnabled: false, since: '2026-05-20T15:30:00.000Z' });
    });

    describe('defensive fallback when the row is missing', () => {
        let warnSpy: ReturnType<typeof spyOn>;

        beforeEach(() => {
            warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
        });

        afterEach(() => {
            warnSpy.mockRestore();
        });

        it('returns enabled with the unix epoch as since and warns', async () => {
            const repo = buildRepo({ findSingleton: async () => null });

            const result = await getSystemState(repo);

            expect(result).toEqual({ irrigationEnabled: true, since: '1970-01-01T00:00:00.000Z' });
            const messages = warnSpy.mock.calls.map(args => String((args as unknown[])[0]));
            expect(messages.some(m => m.includes('singleton row missing'))).toBe(true);
        });
    });
});

describe('setIrrigationEnabled', () => {
    it('upserts via the repository and returns the DTO with the passed enabled + now', async () => {
        const upsertCalls: Array<{ enabled: boolean; now: Date }> = [];
        const repo = buildRepo({
            upsertSingleton: async (enabled, now) => {
                upsertCalls.push({ enabled, now });
            },
        });
        const now = new Date('2026-05-20T17:00:00.000Z');

        const result = await setIrrigationEnabled(repo, false, now);

        expect(result).toEqual({ irrigationEnabled: false, since: '2026-05-20T17:00:00.000Z' });
        expect(upsertCalls).toEqual([{ enabled: false, now }]);
    });

    it('round-trips through a paired repository (get-after-set sees the new state)', async () => {
        let storedEnabled = true;
        let storedSince = new Date('2026-05-20T10:00:00.000Z');
        const repo: SystemStateRepository = {
            findSingleton: async () => ({ irrigationEnabled: storedEnabled, since: storedSince }),
            upsertSingleton: async (enabled, now) => {
                storedEnabled = enabled;
                storedSince = now;
            },
        };
        const flippedAt = new Date('2026-05-20T18:00:00.000Z');

        const post = await setIrrigationEnabled(repo, false, flippedAt);
        const read = await getSystemState(repo);

        expect(post.irrigationEnabled).toBe(false);
        expect(post.since).toBe(flippedAt.toISOString());
        expect(read).toEqual(post);
    });
});
