import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import type {
    ExpoPushMessage,
    ExpoPushReceipt,
    ExpoPushReceiptId,
    ExpoPushTicket,
} from 'expo-server-sdk';
import type { PushAlertEvent } from '@/models/push-token';
import type { PushToken, PushTokensRepository } from '@/repositories/push-tokens';
import {
    bootPushTokensService,
    dispatchAlertPush,
    pollReceipts,
    registerPushToken,
    unregisterPushToken,
    type ExpoPushClient,
    type SchedulePoll,
} from '.';

const NOW = new Date('2026-05-22T12:00:00.000Z');
const CHUNK_LIMIT = 100;

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

type FakeExpoState = {
    sendChunks: ExpoPushMessage[][];
    receiptChunks: ExpoPushReceiptId[][];
    sendResults: ExpoPushTicket[][];
    sendRejections: Array<Error | null>;
    receiptResults: Array<{ [id: string]: ExpoPushReceipt }>;
    receiptRejections: Array<Error | null>;
};

function fakeExpoClient(): { expo: ExpoPushClient; state: FakeExpoState } {
    const state: FakeExpoState = {
        sendChunks: [],
        receiptChunks: [],
        sendResults: [],
        sendRejections: [],
        receiptResults: [],
        receiptRejections: [],
    };
    const expo: ExpoPushClient = {
        chunkPushNotifications: (messages) => {
            const chunks: ExpoPushMessage[][] = [];
            for (let i = 0; i < messages.length; i += CHUNK_LIMIT) {
                chunks.push(messages.slice(i, i + CHUNK_LIMIT));
            }
            return chunks;
        },
        sendPushNotificationsAsync: async (chunk) => {
            const index = state.sendChunks.length;
            state.sendChunks.push(chunk);
            const rejection = state.sendRejections[index] ?? null;
            if (rejection) throw rejection;
            const result = state.sendResults[index];
            if (!result) {
                return chunk.map((_, i) => ({ status: 'ok' as const, id: `default-ticket-${index}-${i}` }));
            }
            return result;
        },
        chunkPushNotificationReceiptIds: (ids) => {
            const chunks: ExpoPushReceiptId[][] = [];
            for (let i = 0; i < ids.length; i += CHUNK_LIMIT) {
                chunks.push(ids.slice(i, i + CHUNK_LIMIT));
            }
            return chunks;
        },
        getPushNotificationReceiptsAsync: async (idsChunk) => {
            const index = state.receiptChunks.length;
            state.receiptChunks.push(idsChunk);
            const rejection = state.receiptRejections[index] ?? null;
            if (rejection) throw rejection;
            return state.receiptResults[index] ?? {};
        },
    };
    return { expo, state };
}

type CapturedPoll = { fn: () => void; delayMs: number };

function recordSchedulePoll(): { schedulePoll: SchedulePoll; captured: CapturedPoll[] } {
    const captured: CapturedPoll[] = [];
    const schedulePoll: SchedulePoll = (fn, delayMs) => {
        captured.push({ fn, delayMs });
    };
    return { schedulePoll, captured };
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
        const { expo } = fakeExpoClient();
        bootPushTokensService({ repo, expo });
    });

    it('forwards token, platform, and userAgent to the repo', async () => {
        const { repo, state } = fakeRepo();
        const { expo } = fakeExpoClient();
        bootPushTokensService({ repo, expo });

        await registerPushToken({ token: 'tok-A', platform: 'ios', userAgent: 'irrigo/1.0 iOS 17' });

        expect(state.upserts).toEqual([{ token: 'tok-A', platform: 'ios', userAgent: 'irrigo/1.0 iOS 17' }]);
    });

    it('passes a null userAgent through to the repo', async () => {
        const { repo, state } = fakeRepo();
        const { expo } = fakeExpoClient();
        bootPushTokensService({ repo, expo });

        await registerPushToken({ token: 'tok-B', platform: 'android', userAgent: null });

        expect(state.upserts[0]?.userAgent).toBeNull();
    });

    it('throws without touching the repo when platform is invalid', async () => {
        const { repo, state } = fakeRepo();
        const { expo } = fakeExpoClient();
        bootPushTokensService({ repo, expo });

        await expect(
            registerPushToken({ token: 'tok-X', platform: 'symbian' as unknown as 'ios', userAgent: null }),
        ).rejects.toThrow(/invalid platform/);
        expect(state.upserts).toEqual([]);
    });
});

describe('unregisterPushToken', () => {
    it('forwards the token to the repo', async () => {
        const { repo, state } = fakeRepo([buildToken({ token: 'tok-existing' })]);
        const { expo } = fakeExpoClient();
        bootPushTokensService({ repo, expo });

        await unregisterPushToken('tok-existing');

        expect(state.deletes).toEqual(['tok-existing']);
    });

    it('resolves successfully when the token does not exist (repo no-ops)', async () => {
        const { repo } = fakeRepo();
        const { expo } = fakeExpoClient();
        bootPushTokensService({ repo, expo });

        await expect(unregisterPushToken('tok-missing')).resolves.toBeUndefined();
    });
});

describe('dispatchAlertPush', () => {
    let warnSpy: ReturnType<typeof spyOn>;

    beforeEach(() => {
        warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        warnSpy.mockRestore();
    });

    it('does nothing and calls no SDK methods when no tokens are registered', async () => {
        const { repo } = fakeRepo([]);
        const { expo, state: expoState } = fakeExpoClient();
        const { schedulePoll, captured } = recordSchedulePoll();
        bootPushTokensService({ repo, expo, schedulePoll });

        await dispatchAlertPush(buildAlertEvent());

        expect(expoState.sendChunks).toEqual([]);
        expect(captured).toEqual([]);
    });

    it('builds one message per token with title, body, data, and priority', async () => {
        const { repo } = fakeRepo([
            buildToken({ token: 'tok-1' }),
            buildToken({ id: 'pt-2', token: 'tok-2' }),
        ]);
        const { expo, state: expoState } = fakeExpoClient();
        const { schedulePoll } = recordSchedulePoll();
        bootPushTokensService({ repo, expo, schedulePoll });

        await dispatchAlertPush(buildAlertEvent({ alertId: 'alert-X', sub: 'sub-line', zoneId: 'zone-001' }));

        expect(expoState.sendChunks).toHaveLength(1);
        const sent = expoState.sendChunks[0]!;
        expect(sent.map(m => m.to)).toEqual(['tok-1', 'tok-2']);
        expect(sent[0]!.title).toBe('HA close failed');
        expect(sent[0]!.body).toBe('sub-line');
        expect(sent[0]!.data).toEqual({ alertId: 'alert-X', class: 'ha-call-failed', zoneId: 'zone-001' });
        expect(sent[0]!.priority).toBe('high');
    });

    it('uses title as the body when sub is null', async () => {
        const { repo } = fakeRepo([buildToken()]);
        const { expo, state: expoState } = fakeExpoClient();
        const { schedulePoll } = recordSchedulePoll();
        bootPushTokensService({ repo, expo, schedulePoll });

        await dispatchAlertPush(buildAlertEvent({ sub: null, title: 'Only title here' }));

        expect(expoState.sendChunks[0]![0]!.body).toBe('Only title here');
    });

    it(`sets priority to 'default' for warn tone`, async () => {
        const { repo } = fakeRepo([buildToken()]);
        const { expo, state: expoState } = fakeExpoClient();
        const { schedulePoll } = recordSchedulePoll();
        bootPushTokensService({ repo, expo, schedulePoll });

        await dispatchAlertPush(buildAlertEvent({ tone: 'warn' }));

        expect(expoState.sendChunks[0]![0]!.priority).toBe('default');
    });

    it('omits zoneId from data when the event has none (global alert)', async () => {
        const { repo } = fakeRepo([buildToken()]);
        const { expo, state: expoState } = fakeExpoClient();
        const { schedulePoll } = recordSchedulePoll();
        bootPushTokensService({ repo, expo, schedulePoll });

        await dispatchAlertPush(buildAlertEvent({ zoneId: null }));

        const data = expoState.sendChunks[0]![0]!.data as Record<string, unknown>;
        expect(data).toEqual({ alertId: 'alert-001', class: 'ha-call-failed' });
        expect('zoneId' in data).toBe(false);
    });

    it('chunks 150 tokens into a 100-token send and a 50-token send', async () => {
        const rows = Array.from({ length: 150 }, (_, i) => buildToken({ id: `pt-${i}`, token: `tok-${i}` }));
        const { repo } = fakeRepo(rows);
        const { expo, state: expoState } = fakeExpoClient();
        const { schedulePoll } = recordSchedulePoll();
        bootPushTokensService({ repo, expo, schedulePoll });

        await dispatchAlertPush(buildAlertEvent());

        expect(expoState.sendChunks).toHaveLength(2);
        expect(expoState.sendChunks[0]!).toHaveLength(100);
        expect(expoState.sendChunks[1]!).toHaveLength(50);
        expect(expoState.sendChunks[0]!.map(m => m.to)).toEqual(rows.slice(0, 100).map(r => r.token));
        expect(expoState.sendChunks[1]!.map(m => m.to)).toEqual(rows.slice(100).map(r => r.token));
    });

    it('prunes only the tokens flagged DeviceNotRegistered in the immediate ticket response', async () => {
        const { repo, state: repoState } = fakeRepo([
            buildToken({ id: 'pt-A', token: 'tok-A' }),
            buildToken({ id: 'pt-B', token: 'tok-B' }),
            buildToken({ id: 'pt-C', token: 'tok-C' }),
        ]);
        const { expo, state: expoState } = fakeExpoClient();
        expoState.sendResults = [[
            { status: 'ok', id: 'ticket-A' },
            { status: 'error', message: 'unregistered', details: { error: 'DeviceNotRegistered' } },
            { status: 'ok', id: 'ticket-C' },
        ]];
        const { schedulePoll, captured } = recordSchedulePoll();
        bootPushTokensService({ repo, expo, schedulePoll });

        await dispatchAlertPush(buildAlertEvent());

        expect(repoState.deletes).toEqual(['tok-B']);
        expect(repoState.rows.map(r => r.token)).toEqual(['tok-A', 'tok-C']);
        expect(captured).toHaveLength(1);
    });

    it('swallows a repo deleteByToken rejection during immediate ticket-prune and warns', async () => {
        const { repo, state: repoState } = fakeRepo([buildToken({ token: 'tok-only' })]);
        const failingRepo: PushTokensRepository = {
            ...repo,
            deleteByToken: async (token) => {
                repoState.deletes.push(token);
                throw new Error('db down');
            },
        };
        const { expo, state: expoState } = fakeExpoClient();
        expoState.sendResults = [[
            { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } },
        ]];
        const { schedulePoll } = recordSchedulePoll();
        bootPushTokensService({ repo: failingRepo, expo, schedulePoll });

        await expect(dispatchAlertPush(buildAlertEvent())).resolves.toBeUndefined();

        expect(repoState.deletes).toEqual(['tok-only']);
        expect(warnSpy).toHaveBeenCalled();
    });

    it('warns but does not prune for non-DeviceNotRegistered ticket errors', async () => {
        const { repo, state: repoState } = fakeRepo([buildToken({ token: 'tok-only' })]);
        const { expo, state: expoState } = fakeExpoClient();
        expoState.sendResults = [[
            { status: 'error', message: 'too big', details: { error: 'MessageTooBig' } },
        ]];
        const { schedulePoll, captured } = recordSchedulePoll();
        bootPushTokensService({ repo, expo, schedulePoll });

        await dispatchAlertPush(buildAlertEvent());

        expect(repoState.deletes).toEqual([]);
        expect(captured).toEqual([]);
        expect(warnSpy).toHaveBeenCalled();
    });

    it('schedules a single receipt poll with a 15-second delay when there are ok tickets', async () => {
        const { repo } = fakeRepo([
            buildToken({ id: 'pt-A', token: 'tok-A' }),
            buildToken({ id: 'pt-B', token: 'tok-B' }),
        ]);
        const { expo, state: expoState } = fakeExpoClient();
        expoState.sendResults = [[
            { status: 'ok', id: 'ticket-A' },
            { status: 'ok', id: 'ticket-B' },
        ]];
        const { schedulePoll, captured } = recordSchedulePoll();
        bootPushTokensService({ repo, expo, schedulePoll });

        await dispatchAlertPush(buildAlertEvent());

        expect(captured).toHaveLength(1);
        expect(captured[0]!.delayMs).toBe(15_000);
        expect(typeof captured[0]!.fn).toBe('function');
    });

    it('does not schedule a receipt poll when no ticket came back ok', async () => {
        const { repo } = fakeRepo([buildToken({ token: 'tok-A' })]);
        const { expo, state: expoState } = fakeExpoClient();
        expoState.sendResults = [[
            { status: 'error', message: 'unregistered', details: { error: 'DeviceNotRegistered' } },
        ]];
        const { schedulePoll, captured } = recordSchedulePoll();
        bootPushTokensService({ repo, expo, schedulePoll });

        await dispatchAlertPush(buildAlertEvent());

        expect(captured).toEqual([]);
    });

    it('warns and keeps processing remaining chunks when one chunk send rejects', async () => {
        const rows = Array.from({ length: 150 }, (_, i) => buildToken({ id: `pt-${i}`, token: `tok-${i}` }));
        const { repo, state: repoState } = fakeRepo(rows);
        const { expo, state: expoState } = fakeExpoClient();
        expoState.sendRejections = [new Error('network down'), null];
        expoState.sendResults = [
            [],
            [{ status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } }, ...Array.from({ length: 49 }, (_, i) => ({ status: 'ok' as const, id: `t-${i}` }))],
        ];
        const { schedulePoll, captured } = recordSchedulePoll();
        bootPushTokensService({ repo, expo, schedulePoll });

        await dispatchAlertPush(buildAlertEvent());

        expect(expoState.sendChunks).toHaveLength(2);
        expect(warnSpy).toHaveBeenCalled();
        expect(repoState.deletes).toEqual(['tok-100']);
        expect(captured).toHaveLength(1);
    });
});

describe('pollReceipts', () => {
    let warnSpy: ReturnType<typeof spyOn>;

    beforeEach(() => {
        warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        warnSpy.mockRestore();
    });

    it('is a no-op when given no pending tickets', async () => {
        const { repo, state: repoState } = fakeRepo([]);
        const { expo, state: expoState } = fakeExpoClient();
        bootPushTokensService({ repo, expo });

        await pollReceipts([]);

        expect(expoState.receiptChunks).toEqual([]);
        expect(repoState.deletes).toEqual([]);
    });

    it('prunes only tokens whose receipt comes back as DeviceNotRegistered', async () => {
        const { repo, state: repoState } = fakeRepo([
            buildToken({ id: 'pt-A', token: 'tok-A' }),
            buildToken({ id: 'pt-B', token: 'tok-B' }),
            buildToken({ id: 'pt-C', token: 'tok-C' }),
        ]);
        const { expo, state: expoState } = fakeExpoClient();
        expoState.receiptResults = [{
            'ticket-A': { status: 'ok' },
            'ticket-B': { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } },
            'ticket-C': { status: 'error', message: 'too big', details: { error: 'MessageTooBig' } },
        }];
        bootPushTokensService({ repo, expo });

        await pollReceipts([
            { ticketId: 'ticket-A', token: 'tok-A' },
            { ticketId: 'ticket-B', token: 'tok-B' },
            { ticketId: 'ticket-C', token: 'tok-C' },
        ]);

        expect(expoState.receiptChunks).toHaveLength(1);
        expect(expoState.receiptChunks[0]!.sort()).toEqual(['ticket-A', 'ticket-B', 'ticket-C']);
        expect(repoState.deletes).toEqual(['tok-B']);
        expect(repoState.rows.map(r => r.token).sort()).toEqual(['tok-A', 'tok-C']);
    });

    it('swallows a repo deleteByToken rejection during receipt-prune and warns', async () => {
        const { repo, state: repoState } = fakeRepo([buildToken({ token: 'tok-B' })]);
        const failingRepo: PushTokensRepository = {
            ...repo,
            deleteByToken: async (token) => {
                repoState.deletes.push(token);
                throw new Error('db down');
            },
        };
        const { expo, state: expoState } = fakeExpoClient();
        expoState.receiptResults = [{
            'ticket-B': { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } },
        }];
        bootPushTokensService({ repo: failingRepo, expo });

        await expect(
            pollReceipts([{ ticketId: 'ticket-B', token: 'tok-B' }]),
        ).resolves.toBeUndefined();

        expect(repoState.deletes).toEqual(['tok-B']);
        expect(warnSpy).toHaveBeenCalled();
    });

    it('warns and skips the rest of the chunk when receipt fetch rejects, then processes the next chunk', async () => {
        const pending = Array.from({ length: 150 }, (_, i) => ({
            ticketId: `ticket-${i}`,
            token: `tok-${i}`,
        }));
        const tokens = pending.map(p => buildToken({ id: `pt-${p.token}`, token: p.token }));
        const { repo, state: repoState } = fakeRepo(tokens);
        const { expo, state: expoState } = fakeExpoClient();
        expoState.receiptRejections = [new Error('boom'), null];
        expoState.receiptResults = [
            {},
            {
                'ticket-100': { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } },
            },
        ];
        bootPushTokensService({ repo, expo });

        await pollReceipts(pending);

        expect(expoState.receiptChunks).toHaveLength(2);
        expect(warnSpy).toHaveBeenCalled();
        expect(repoState.deletes).toEqual(['tok-100']);
    });
});
