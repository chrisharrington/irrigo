import Expo, {
    type ExpoPushMessage,
    type ExpoPushReceipt,
    type ExpoPushReceiptId,
    type ExpoPushTicket,
} from 'expo-server-sdk';
import type { Database } from '@/db';
import type { PushAlertEvent, PushRegistration } from '@/models/push-token';
import {
    createPushTokensRepository,
    type PushTokensRepository,
} from '@/repositories/push-tokens';

const RECEIPT_POLL_DELAY_MS = 15_000;

/**
 * Injectable subset of `expo-server-sdk`'s `Expo` class. Production passes a
 * real `new Expo()` (which satisfies this shape directly); tests pass an
 * object literal so the chunking, send, and receipt-poll behaviour can be
 * driven without a network.
 */
export type ExpoPushClient = {
    chunkPushNotifications(messages: ExpoPushMessage[]): ExpoPushMessage[][];
    sendPushNotificationsAsync(chunk: ExpoPushMessage[]): Promise<ExpoPushTicket[]>;
    chunkPushNotificationReceiptIds(ids: ExpoPushReceiptId[]): ExpoPushReceiptId[][];
    getPushNotificationReceiptsAsync(
        idsChunk: ExpoPushReceiptId[],
    ): Promise<{ [id: string]: ExpoPushReceipt }>;
};

/**
 * Schedules the deferred receipt-poll. Production wires `setTimeout`; tests
 * pass a recorder that captures the callback so the test can invoke it
 * synchronously and inspect the resulting receipts behaviour.
 */
export type SchedulePoll = (fn: () => void, delayMs: number) => void;

/**
 * Input to `bootPushTokensService`. Production passes `{ db }`; tests pass
 * `{ repo }` with an object-literal fake. Both branches optionally accept an
 * `expo` client and a `schedulePoll` scheduler — defaults wire to a real
 * `Expo` instance and `setTimeout`.
 */
export type BootPushTokensServiceInput =
    | { db: Database; expo?: ExpoPushClient; schedulePoll?: SchedulePoll }
    | { repo: PushTokensRepository; expo?: ExpoPushClient; schedulePoll?: SchedulePoll };

let repo: PushTokensRepository | null = null;
let expo: ExpoPushClient | null = null;
let schedulePoll: SchedulePoll = (fn, delayMs) => {
    setTimeout(fn, delayMs);
};

/**
 * Wires the push tokens service to its repository, Expo client, and poll
 * scheduler. Call once at process boot; call again in test `beforeEach` with
 * fakes to isolate behaviour.
 */
export function bootPushTokensService(input: BootPushTokensServiceInput): void {
    repo = 'repo' in input ? input.repo : createPushTokensRepository(input.db);
    expo = input.expo ?? new Expo();
    if (input.schedulePoll) schedulePoll = input.schedulePoll;
}

function getRepo(): PushTokensRepository {
    if (!repo) {
        throw new Error('Push tokens service not booted — call bootPushTokensService({ db }) at startup.');
    }
    return repo;
}

function getExpo(): ExpoPushClient {
    if (!expo) {
        throw new Error('Push tokens service not booted — call bootPushTokensService({ db }) at startup.');
    }
    return expo;
}

/**
 * Registers (or refreshes) a device's Expo push token. Validates the platform
 * before touching the repo so callers can map the throw to a 400 — the DB
 * check constraint catches anything that slips past as a second line of
 * defense.
 */
export async function registerPushToken(input: PushRegistration): Promise<void> {
    if (input.platform !== 'ios' && input.platform !== 'android') {
        throw new Error(`invalid platform: ${String(input.platform)}`);
    }
    await getRepo().upsertByToken({
        token: input.token,
        platform: input.platform,
        userAgent: input.userAgent,
    });
    console.log(`push: registered token for platform=${input.platform}.`);
}

/**
 * Removes a device's push token. Idempotent: resolves successfully whether or
 * not the token was previously registered.
 */
export async function unregisterPushToken(token: string): Promise<void> {
    await getRepo().deleteByToken(token);
    console.log('push: unregistered token.');
}

/**
 * Fires an Expo Push to every registered token for a single alert. Called by
 * the alerter on insert (a brand-new alert) — dedup-updates suppress it,
 * matching the existing "loud once, quiet until acked" semantics.
 *
 * Best-effort throughout: chunk-level send failures are logged at `warn` and
 * the remaining chunks still attempt to deliver. Tickets are scanned for
 * immediate `DeviceNotRegistered` errors (rare but possible) and matching
 * tokens are pruned right away. Successful tickets are queued for a deferred
 * receipt poll — Expo surfaces most `DeviceNotRegistered` outcomes there, not
 * in the immediate ticket response.
 */
export async function dispatchAlertPush(event: PushAlertEvent): Promise<void> {
    const tokens = await getRepo().listAll();
    if (tokens.length === 0) return;

    const client = getExpo();

    const data: Record<string, unknown> = {
        alertId: event.alertId,
        class: event.class,
    };
    if (event.zoneId !== null) data['zoneId'] = event.zoneId;

    const messages: ExpoPushMessage[] = tokens.map(t => ({
        to: t.token,
        title: event.title,
        body: event.sub ?? event.title,
        data,
        priority: event.tone === 'danger' ? 'high' : 'default',
    }));

    const chunks = client.chunkPushNotifications(messages);
    const pendingReceipts: Array<{ ticketId: string; token: string }> = [];
    let messageCursor = 0;

    for (const chunk of chunks) {
        const chunkTokens = tokens.slice(messageCursor, messageCursor + chunk.length);
        messageCursor += chunk.length;

        let tickets: ExpoPushTicket[];
        try {
            tickets = await client.sendPushNotificationsAsync(chunk);
        } catch (err) {
            console.warn(`push: expo send failed for chunk of ${chunk.length}; swallowing.`, err);
            continue;
        }

        for (let i = 0; i < tickets.length; i++) {
            const ticket = tickets[i]!;
            const token = chunkTokens[i]?.token;
            if (token === undefined) continue;

            if (ticket.status === 'ok') {
                pendingReceipts.push({ ticketId: ticket.id, token });
                continue;
            }

            if (ticket.details?.error === 'DeviceNotRegistered') {
                try {
                    await getRepo().deleteByToken(token);
                    console.log('push: pruned unregistered token from ticket response (DeviceNotRegistered).');
                } catch (err) {
                    console.warn('push: failed to prune unregistered token; swallowing.', err);
                }
                continue;
            }

            console.warn(
                `push: expo ticket error (${ticket.details?.error ?? 'unknown'}): ${ticket.message}`,
            );
        }
    }

    if (pendingReceipts.length === 0) return;

    schedulePoll(() => {
        pollReceipts(pendingReceipts).catch(err => {
            console.warn('push: unhandled receipt poll failure; swallowing.', err);
        });
    }, RECEIPT_POLL_DELAY_MS);
}

/**
 * Polls Expo for the receipts of the given tickets and prunes any token whose
 * receipt comes back flagged `DeviceNotRegistered`. Best-effort throughout:
 * per-chunk and per-prune errors are logged at `warn` and skipped.
 *
 * Exported for tests; production callers should rely on the scheduled poll
 * arranged by `dispatchAlertPush`.
 */
export async function pollReceipts(
    pending: ReadonlyArray<{ ticketId: string; token: string }>,
): Promise<void> {
    if (pending.length === 0) return;
    const client = getExpo();

    const ticketToToken = new Map<string, string>();
    for (const entry of pending) ticketToToken.set(entry.ticketId, entry.token);

    const idChunks = client.chunkPushNotificationReceiptIds([...ticketToToken.keys()]);
    for (const idChunk of idChunks) {
        let receipts: { [id: string]: ExpoPushReceipt };
        try {
            receipts = await client.getPushNotificationReceiptsAsync(idChunk);
        } catch (err) {
            console.warn(`push: expo receipt fetch failed for chunk of ${idChunk.length}; swallowing.`, err);
            continue;
        }

        for (const [ticketId, receipt] of Object.entries(receipts)) {
            if (receipt.status !== 'error') continue;
            if (receipt.details?.error !== 'DeviceNotRegistered') {
                console.warn(
                    `push: expo receipt error (${receipt.details?.error ?? 'unknown'}): ${receipt.message}`,
                );
                continue;
            }
            const token = ticketToToken.get(ticketId);
            if (token === undefined) continue;
            try {
                await getRepo().deleteByToken(token);
                console.log('push: pruned unregistered token from receipt (DeviceNotRegistered).');
            } catch (err) {
                console.warn('push: failed to prune unregistered token; swallowing.', err);
            }
        }
    }
}

