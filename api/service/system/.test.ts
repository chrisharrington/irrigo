import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import {
    getSystemState,
    setIrrigationEnabled,
    type SystemServiceRepo,
} from '.';

// Sentinel db value — service tests fake the repo so the db payload doesn't
// actually flow into Drizzle. Cast through `never` to satisfy the type
// without inventing fake reader/writer chains.
const STUB_DB = {} as never;

describe('getSystemState', () => {
    it('maps the loaded row to a DTO with ISO since', async () => {
        const since = new Date('2026-05-20T14:00:00.000Z');
        const fakeRepo: Pick<SystemServiceRepo, 'loadSystemState'> = {
            loadSystemState: async () => ({ irrigationEnabled: true, since }),
        };

        const result = await getSystemState(STUB_DB, fakeRepo);

        expect(result).toEqual({ irrigationEnabled: true, since: '2026-05-20T14:00:00.000Z' });
    });

    it('passes through the disabled state with ISO since', async () => {
        const since = new Date('2026-05-20T15:30:00.000Z');
        const fakeRepo: Pick<SystemServiceRepo, 'loadSystemState'> = {
            loadSystemState: async () => ({ irrigationEnabled: false, since }),
        };

        const result = await getSystemState(STUB_DB, fakeRepo);

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
            const fakeRepo: Pick<SystemServiceRepo, 'loadSystemState'> = {
                loadSystemState: async () => null,
            };

            const result = await getSystemState(STUB_DB, fakeRepo);

            expect(result).toEqual({ irrigationEnabled: true, since: '1970-01-01T00:00:00.000Z' });
            const messages = warnSpy.mock.calls.map(args => String((args as unknown[])[0]));
            expect(messages.some(m => m.includes('singleton row missing'))).toBe(true);
        });
    });

    it('forwards the db handle through to the loader', async () => {
        const sentinelDb = { sentinel: true } as never;
        let received: unknown;
        const fakeRepo: Pick<SystemServiceRepo, 'loadSystemState'> = {
            loadSystemState: async db => {
                received = db;
                return { irrigationEnabled: true, since: new Date(0) };
            },
        };

        await getSystemState(sentinelDb, fakeRepo);

        expect(received).toBe(sentinelDb);
    });
});

describe('setIrrigationEnabled', () => {
    it('upserts via the repository and returns the DTO with the passed enabled + now', async () => {
        const upsertCalls: Array<{ enabled: boolean; now: Date }> = [];
        const fakeRepo: Pick<SystemServiceRepo, 'upsertSystemState'> = {
            upsertSystemState: async (_db, enabled, now) => {
                upsertCalls.push({ enabled, now });
            },
        };
        const now = new Date('2026-05-20T17:00:00.000Z');

        const result = await setIrrigationEnabled(STUB_DB, false, now, fakeRepo);

        expect(result).toEqual({ irrigationEnabled: false, since: '2026-05-20T17:00:00.000Z' });
        expect(upsertCalls).toEqual([{ enabled: false, now }]);
    });

    it('round-trips through a paired loader/upsert fake (get-after-set sees the new state)', async () => {
        // After set flips to disabled, a subsequent get with a loader pointing
        // at the same state surfaces the new flag.
        let storedEnabled = true;
        let storedSince = new Date('2026-05-20T10:00:00.000Z');
        const repo: SystemServiceRepo = {
            loadSystemState: async () => ({ irrigationEnabled: storedEnabled, since: storedSince }),
            upsertSystemState: async (_db, enabled, now) => {
                storedEnabled = enabled;
                storedSince = now;
            },
        };
        const flippedAt = new Date('2026-05-20T18:00:00.000Z');

        const post = await setIrrigationEnabled(STUB_DB, false, flippedAt, repo);
        const read = await getSystemState(STUB_DB, repo);

        expect(post.irrigationEnabled).toBe(false);
        expect(post.since).toBe(flippedAt.toISOString());
        expect(read).toEqual(post);
    });
});
