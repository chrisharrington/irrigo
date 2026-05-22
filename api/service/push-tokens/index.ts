import type { Database } from '@/db';
import type { PushAlertEvent, PushRegistration } from '@/models/push-token';
import {
    createPushTokensRepository,
    type PushToken,
    type PushTokensRepository,
} from '@/repositories/push-tokens';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

/**
 * Input to `bootPushTokensService`. Production passes `{ db }`; tests pass
 * `{ repo }` with an object-literal fake.
 */
export type BootPushTokensServiceInput =
    | { db: Database }
    | { repo: PushTokensRepository };

let repo: PushTokensRepository | null = null;

/**
 * Wires the push tokens service to its repository. Call once at process boot;
 * call again in test `beforeEach` with a fake to isolate behavior.
 */
export function bootPushTokensService(input: BootPushTokensServiceInput): void {
    repo = 'repo' in input ? input.repo : createPushTokensRepository(input.db);
}

function getRepo(): PushTokensRepository {
    if (!repo) {
        throw new Error('Push tokens service not booted — call bootPushTokensService({ db }) at startup.');
    }
    return repo;
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

type ExpoTicket = {
    status: 'ok' | 'error';
    id?: string;
    message?: string;
    details?: { error?: string };
};

/**
 * Fires an Expo Push to every registered token for a single alert. Called by
 * the alerter on insert (a brand-new alert) — dedup-updates suppress it,
 * matching the existing "loud once, quiet until acked" semantics.
 *
 * Best-effort throughout: a network or HTTP error is logged at `warn` and
 * swallowed so the alert write is never disrupted. The Expo response is
 * scanned for per-token `DeviceNotRegistered` receipts; matching tokens are
 * pruned from the table so the next dispatch doesn't repeat the error.
 */
export async function dispatchAlertPush(event: PushAlertEvent): Promise<void> {
    const tokens = await getRepo().listAll();
    if (tokens.length === 0) return;

    const data: Record<string, unknown> = {
        alertId: event.alertId,
        class: event.class,
    };
    if (event.zoneId !== null) data['zoneId'] = event.zoneId;

    const body = JSON.stringify({
        to: tokens.map(t => t.token),
        title: event.title,
        body: event.sub ?? event.title,
        data,
        priority: event.tone === 'danger' ? 'high' : 'default',
    });

    let response: Response;
    try {
        response = await fetch(EXPO_PUSH_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body,
        });
    } catch (err) {
        console.warn('push: expo fetch failed; swallowing.', err);
        return;
    }

    if (!response.ok) {
        console.warn(`push: expo returned ${response.status} ${response.statusText}.`);
        return;
    }

    let parsed: { data?: ExpoTicket[] };
    try {
        parsed = (await response.json()) as { data?: ExpoTicket[] };
    } catch (err) {
        console.warn('push: expo response was not JSON; skipping receipt scan.', err);
        return;
    }

    const tickets = parsed.data ?? [];
    await pruneUnregistered(tokens, tickets);
}

async function pruneUnregistered(tokens: PushToken[], tickets: ExpoTicket[]): Promise<void> {
    const max = Math.min(tokens.length, tickets.length);
    for (let i = 0; i < max; i++) {
        const ticket = tickets[i]!;
        if (ticket.status !== 'error') continue;
        if (ticket.details?.error !== 'DeviceNotRegistered') continue;
        const token = tokens[i]!.token;
        try {
            await getRepo().deleteByToken(token);
            console.log(`push: pruned unregistered token (DeviceNotRegistered).`);
        } catch (err) {
            console.warn('push: failed to prune unregistered token; swallowing.', err);
        }
    }
}
