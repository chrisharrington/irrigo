import Expo, {
    type ExpoPushMessage,
    type ExpoPushReceipt,
    type ExpoPushReceiptId,
    type ExpoPushTicket,
} from 'expo-server-sdk';
import type { Database } from '@/db';
import type { NotificationSettingsDto } from '@/models/notification-settings';
import type { PushAlertEvent, PushRegistration } from '@/models/push-token';
import {
    createPushTokensRepository,
    type PushTokensRepository,
} from '@/repositories/push-tokens';
import { getNotificationSettings } from '@/service/notification-settings';

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
 * Self-contained content of a single push notification, fanned out unchanged
 * to every registered device by `sendPushToAll`. `data` rides along as the
 * Expo `data` payload (the client routes on it); `priority` maps to Expo's
 * delivery priority and defaults to `'default'`.
 */
export type PushMessageContent = {
    title: string;
    body: string;
    data?: Record<string, unknown>;
    priority?: 'default' | 'high';
};

/**
 * The notification categories the operator can toggle. Each is exactly a key
 * of `NotificationSettingsDto`, so gating is a single flag lookup — see
 * `sendCategoryPush`.
 */
export type NotificationCategory = keyof NotificationSettingsDto;

/**
 * Injectable shape of `sendCategoryPush` — a gated push for one category. The
 * daemon and manual controller take one of these so lifecycle producers can
 * fire Expo pushes without importing the push singleton directly (and so tests
 * can record the calls). `sendCategoryPush` satisfies it; production wires that
 * in, tests pass a recorder, and `noopCategoryPush` is the safe default.
 */
export type CategoryPushNotifier = (category: NotificationCategory, content: PushMessageContent) => Promise<void>;

/**
 * No-op `CategoryPushNotifier`: resolves immediately, sends nothing. The
 * default when no push channel is injected (tests, or a daemon booted without
 * push wiring).
 */
export const noopCategoryPush: CategoryPushNotifier = async () => {};

/**
 * Fires one Expo Push to every registered token, carrying the given content.
 * The general send primitive underlying both the gated `sendCategoryPush` and
 * the alert dispatcher.
 *
 * Best-effort throughout: chunk-level send failures are logged at `warn` and
 * the remaining chunks still attempt to deliver. Tickets are scanned for
 * immediate `DeviceNotRegistered` errors (rare but possible) and matching
 * tokens are pruned right away. Successful tickets are queued for a deferred
 * receipt poll — Expo surfaces most `DeviceNotRegistered` outcomes there, not
 * in the immediate ticket response.
 */
export async function sendPushToAll(content: PushMessageContent): Promise<void> {
    const tokens = await getRepo().listAll();
    if (tokens.length === 0) return;

    const client = getExpo();

    const messages: ExpoPushMessage[] = tokens.map(t => ({
        to: t.token,
        title: content.title,
        body: content.body,
        ...(content.data !== undefined ? { data: content.data } : {}),
        priority: content.priority ?? 'default',
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
 * Sends a push for `category`, gated on the live `notification_settings` flag
 * of the same name (API-101). When the toggle is off the push is suppressed —
 * logged, never sent. The single entry point producers should use so the
 * operator's per-event toggles take effect on the very next event without a
 * restart. Requires `bootNotificationSettingsService` to have run.
 */
export async function sendCategoryPush(category: NotificationCategory, content: PushMessageContent): Promise<void> {
    const flags = await getNotificationSettings();
    if (!flags[category]) {
        console.log(`push: ${category} notification suppressed by settings toggle.`);
        return;
    }
    await sendPushToAll(content);
}

/**
 * Fires an Expo Push to every registered token for a single alert. Called by
 * the alerter on insert (a brand-new alert) — dedup-updates suppress it,
 * matching the existing "loud once, quiet until acked" semantics. Gated on the
 * `error` toggle via `sendCategoryPush`, so disabling Errors in the app
 * silences failure pushes.
 */
export async function dispatchAlertPush(event: PushAlertEvent): Promise<void> {
    const data: Record<string, unknown> = {
        alertId: event.alertId,
        class: event.class,
    };
    if (event.zoneId !== null) data['zoneId'] = event.zoneId;

    await sendCategoryPush('error', {
        title: event.title,
        body: event.sub ?? event.title,
        data,
        priority: event.tone === 'danger' ? 'high' : 'default',
    });
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

