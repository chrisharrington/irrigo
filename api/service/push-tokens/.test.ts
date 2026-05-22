import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import type { PushAlertEvent } from '@/models/push-token';
import type { PushToken, PushTokensRepository } from '@/repositories/push-tokens';
import {
    bootPushTokensService,
    dispatchAlertPush,
    registerPushToken,
    unregisterPushToken,
} from '.';

const mockFetch = mock(() => Promise.resolve({} as Response));
(global as unknown as { fetch: typeof mockFetch }).fetch = mockFetch;

const NOW = new Date('2026-05-22T12:00:00.000Z');

type UpsertCall = { token: string; platform: 'ios' | 'android'; userAgent: string | null };

type FakeRepoState = {
    upserts: UpsertCall[];
    deletes: string[];
    rows: PushToken[];
};

function buildToken(overrides?: Partial<PushToken>): PushToken {
    return {
        id: 'pt-001',
        token: 'ExponentPushToken[abc]',
        platform: 'ios',
        userAgent: 'irrigo/1.0',
        createdAt: NOW,
        updatedAt: NOW,
        ...overrides,
    };
}

function fakeRepo(rows: PushToken[] = []): { repo: PushTokensRepository; state: FakeRepoState } {
    const state: FakeRepoState = { upserts: [], deletes: [], rows: [...rows] };
    const repo: PushTokensRepository = {
        upsertByToken: async (input) => {
            state.upserts.push(input);
            const existing = state.rows.findIndex(r => r.token === input.token);
            const next = buildToken({
                id: existing >= 0 ? state.rows[existing]!.id : `pt-${state.upserts.length}`,
                token: input.token,
                platform: input.platform,
                userAgent: input.userAgent,
            });
            if (existing >= 0) state.rows[existing] = next;
            else state.rows.push(next);
        },
        deleteByToken: async (token) => {
            state.deletes.push(token);
            state.rows = state.rows.filter(r => r.token !== token);
        },
        listAll: async () => [...state.rows],
    };
    return { repo, state };
}

function buildAlertEvent(overrides?: Partial<PushAlertEvent>): PushAlertEvent {
    return {
        alertId: 'alert-001',
        class: 'ha-call-failed',
        tone: 'danger',
        title: 'HA close failed',
        sub: 'North · ECONNREFUSED',
        zoneId: 'zone-001',
        ...overrides,
    };
}

describe('registerPushToken', () => {
    beforeEach(() => {
        const { repo } = fakeRepo();
        bootPushTokensService({ repo });
    });

    it('forwards token, platform, and userAgent to the repo', async () => {
        const { repo, state } = fakeRepo();
        bootPushTokensService({ repo });

        await registerPushToken({ token: 'tok-A', platform: 'ios', userAgent: 'irrigo/1.0 iOS 17' });

        expect(state.upserts).toEqual([{ token: 'tok-A', platform: 'ios', userAgent: 'irrigo/1.0 iOS 17' }]);
    });

    it('passes a null userAgent through to the repo', async () => {
        const { repo, state } = fakeRepo();
        bootPushTokensService({ repo });

        await registerPushToken({ token: 'tok-B', platform: 'android', userAgent: null });

        expect(state.upserts[0]?.userAgent).toBeNull();
    });

    it('throws without touching the repo when platform is invalid', async () => {
        const { repo, state } = fakeRepo();
        bootPushTokensService({ repo });

        await expect(
            registerPushToken({ token: 'tok-X', platform: 'symbian' as unknown as 'ios', userAgent: null }),
        ).rejects.toThrow(/invalid platform/);
        expect(state.upserts).toEqual([]);
    });
});

describe('unregisterPushToken', () => {
    it('forwards the token to the repo', async () => {
        const { repo, state } = fakeRepo([buildToken({ token: 'tok-existing' })]);
        bootPushTokensService({ repo });

        await unregisterPushToken('tok-existing');

        expect(state.deletes).toEqual(['tok-existing']);
    });

    it('resolves successfully when the token does not exist (repo no-ops)', async () => {
        const { repo } = fakeRepo();
        bootPushTokensService({ repo });

        await expect(unregisterPushToken('tok-missing')).resolves.toBeUndefined();
    });
});

describe('dispatchAlertPush', () => {
    let warnSpy: ReturnType<typeof spyOn>;

    beforeEach(() => {
        mockFetch.mockClear();
        mockFetch.mockResolvedValue({
            ok: true,
            status: 200,
            statusText: 'OK',
            json: async () => ({ data: [{ status: 'ok' as const, id: 'ticket-1' }] }),
        } as unknown as Response);
        warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        warnSpy.mockRestore();
    });

    it('does not call fetch when no tokens are registered', async () => {
        const { repo } = fakeRepo([]);
        bootPushTokensService({ repo });

        await dispatchAlertPush(buildAlertEvent());

        expect(mockFetch).not.toHaveBeenCalled();
    });

    it('POSTs to the Expo Push URL with title, body, data, and the tokens array', async () => {
        const { repo } = fakeRepo([buildToken({ token: 'tok-1' }), buildToken({ id: 'pt-2', token: 'tok-2' })]);
        bootPushTokensService({ repo });

        await dispatchAlertPush(buildAlertEvent({ alertId: 'alert-X', sub: 'sub-line', zoneId: 'zone-001' }));

        expect(mockFetch).toHaveBeenCalledTimes(1);
        const [calledUrl, init] = mockFetch.mock.calls[0] as [string, RequestInit];
        expect(calledUrl).toBe('https://exp.host/--/api/v2/push/send');
        expect(init.method).toBe('POST');
        expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
        const parsed = JSON.parse(init.body as string) as {
            to: string[];
            title: string;
            body: string;
            data: Record<string, unknown>;
            priority: string;
        };
        expect(parsed.to).toEqual(['tok-1', 'tok-2']);
        expect(parsed.title).toBe('HA close failed');
        expect(parsed.body).toBe('sub-line');
        expect(parsed.data).toEqual({ alertId: 'alert-X', class: 'ha-call-failed', zoneId: 'zone-001' });
    });

    it('uses title as the body when sub is null', async () => {
        const { repo } = fakeRepo([buildToken()]);
        bootPushTokensService({ repo });

        await dispatchAlertPush(buildAlertEvent({ sub: null, title: 'Only title here' }));

        const parsed = JSON.parse((mockFetch.mock.calls[0]![1] as RequestInit).body as string) as { body: string };
        expect(parsed.body).toBe('Only title here');
    });

    it(`sets priority to 'high' for danger tone`, async () => {
        const { repo } = fakeRepo([buildToken()]);
        bootPushTokensService({ repo });

        await dispatchAlertPush(buildAlertEvent({ tone: 'danger' }));

        const parsed = JSON.parse((mockFetch.mock.calls[0]![1] as RequestInit).body as string) as { priority: string };
        expect(parsed.priority).toBe('high');
    });

    it(`sets priority to 'default' for warn tone`, async () => {
        const { repo } = fakeRepo([buildToken()]);
        bootPushTokensService({ repo });

        await dispatchAlertPush(buildAlertEvent({ tone: 'warn' }));

        const parsed = JSON.parse((mockFetch.mock.calls[0]![1] as RequestInit).body as string) as { priority: string };
        expect(parsed.priority).toBe('default');
    });

    it('omits zoneId from data when the event has none (global alert)', async () => {
        const { repo } = fakeRepo([buildToken()]);
        bootPushTokensService({ repo });

        await dispatchAlertPush(buildAlertEvent({ zoneId: null }));

        const parsed = JSON.parse((mockFetch.mock.calls[0]![1] as RequestInit).body as string) as {
            data: Record<string, unknown>;
        };
        expect(parsed.data).toEqual({ alertId: 'alert-001', class: 'ha-call-failed' });
        expect('zoneId' in parsed.data).toBe(false);
    });

    it('swallows fetch rejections and warns; does not prune', async () => {
        mockFetch.mockRejectedValueOnce(new Error('network down'));
        const { repo, state } = fakeRepo([buildToken({ token: 'tok-1' })]);
        bootPushTokensService({ repo });

        await expect(dispatchAlertPush(buildAlertEvent())).resolves.toBeUndefined();
        expect(state.deletes).toEqual([]);
        expect(warnSpy).toHaveBeenCalled();
    });

    it('swallows non-2xx responses and warns; does not prune', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: false,
            status: 500,
            statusText: 'Server Error',
            json: async () => ({}),
        } as unknown as Response);
        const { repo, state } = fakeRepo([buildToken({ token: 'tok-1' })]);
        bootPushTokensService({ repo });

        await dispatchAlertPush(buildAlertEvent());

        expect(state.deletes).toEqual([]);
        expect(warnSpy).toHaveBeenCalled();
    });

    it('prunes only the tokens flagged DeviceNotRegistered in the receipts', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            status: 200,
            statusText: 'OK',
            json: async () => ({
                data: [
                    { status: 'ok' as const, id: 'ticket-A' },
                    { status: 'error' as const, message: 'unregistered', details: { error: 'DeviceNotRegistered' } },
                    { status: 'ok' as const, id: 'ticket-C' },
                ],
            }),
        } as unknown as Response);
        const { repo, state } = fakeRepo([
            buildToken({ id: 'pt-A', token: 'tok-A' }),
            buildToken({ id: 'pt-B', token: 'tok-B' }),
            buildToken({ id: 'pt-C', token: 'tok-C' }),
        ]);
        bootPushTokensService({ repo });

        await dispatchAlertPush(buildAlertEvent());

        expect(state.deletes).toEqual(['tok-B']);
        expect(state.rows.map(r => r.token)).toEqual(['tok-A', 'tok-C']);
    });

    it('tolerates other per-token errors without pruning', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            status: 200,
            statusText: 'OK',
            json: async () => ({
                data: [
                    { status: 'error' as const, message: 'too big', details: { error: 'MessageTooBig' } },
                ],
            }),
        } as unknown as Response);
        const { repo, state } = fakeRepo([buildToken({ token: 'tok-only' })]);
        bootPushTokensService({ repo });

        await dispatchAlertPush(buildAlertEvent());

        expect(state.deletes).toEqual([]);
    });
});
