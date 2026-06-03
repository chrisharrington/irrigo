import type { Zone } from '@/models';
import { HttpResponseError, retry } from './retry';
import { readConfig, readRetryConfig } from './config';

/**
 * One `[onAt, offAt]` interval reconstructed from HA history. `onAt` is the
 * moment the relay went `on` (clamped to `windowStart` if the on-transition
 * predates the window). `offAt` is the moment the relay went `off` (clamped
 * to `windowEnd` if the relay is still on at the window's end). The morning
 * reconciler sums `(offAt − onAt)` across these pairs and multiplies by the
 * zone's precipitation rate to compute applied depth.
 */
export type ZoneActuationInterval = {
    onAt: Date;
    offAt: Date;
};

type HistoryStateRecord = {
    state: string;
    lastChanged: Date;
};

/**
 * Reads the zone's HA switch history over `[since, until)` and returns the
 * set of on→off intervals during which the relay was actually energized.
 * Throws if the HA env vars are missing or the history endpoint returns a
 * 5xx after retry exhaustion; 404 (entity unknown to HA) returns `[]`. The
 * caller is responsible for fallback behavior on failure.
 *
 * @param zone - Zone whose actuation history should be queried.
 * @param since - Inclusive window start; on-transitions before this are clamped to `since`.
 * @param until - Exclusive window end; relays still on at this instant are paired with `until`.
 * @returns Clean on→off intervals, sorted by `onAt`.
 * @throws Error when configuration is missing or HA returns a non-2xx response after retries.
 */
export async function getZoneActuationHistory(
    zone: Zone,
    since: Date,
    until: Date,
): Promise<ZoneActuationInterval[]> {
    if (!zone.homeAssistantEntityId) {
        console.warn(`home-assistant: zone ${zone.id} (${zone.name}) has no homeAssistantEntityId; returning empty actuation history.`);
        return [];
    }

    const { url, token } = readConfig();
    const entityId = zone.homeAssistantEntityId;
    const endpoint = buildHistoryUrl(url, entityId, since, until);

    console.log(`home-assistant: reading actuation history for zone ${zone.id} (${zone.name}) via ${entityId} from ${since.toISOString()} to ${until.toISOString()}.`);

    const retryConfig = readRetryConfig();
    const states = await retry(
        () => sendHistoryRequest(endpoint, token, entityId),
        {
            maxAttempts: retryConfig.maxAttempts,
            baseMs: retryConfig.baseMs,
            operation: 'history_period',
            entityId,
        },
    );

    return pairOnOffTransitions(states, since, until);
}

/**
 * Pure helper. Walks a chronological list of HA state changes and emits the
 * `on→off` intervals during which the entity was energized within the window
 * `[windowStart, windowEnd]`.
 *
 * - `unavailable`, `unknown`, and any non-`on`/`off` state are filtered out.
 * - Consecutive same-state rows are deduped (subsequent `on`s after an `on`
 *   are no-ops; same for `off`s).
 * - An `on` row whose `lastChanged` precedes `windowStart` is clamped to
 *   `windowStart` (the entity was already on when the window opened).
 * - An `off` row whose `lastChanged` exceeds `windowEnd` is clamped to
 *   `windowEnd` (the off transition was outside the window).
 * - A trailing `on` with no following `off` pairs with `windowEnd`.
 * - A leading `off` with no preceding `on` is ignored — the entity was off
 *   when the window opened and had no on period inside it yet.
 *
 * Exported for unit-testing without going through `fetch`.
 */
export function pairOnOffTransitions(
    states: ReadonlyArray<HistoryStateRecord>,
    windowStart: Date,
    windowEnd: Date,
): ZoneActuationInterval[] {
    const filtered = states.filter(s => s.state === 'on' || s.state === 'off');
    if (filtered.length === 0) return [];

    const deduped: HistoryStateRecord[] = [];
    for (const s of filtered) {
        const last = deduped[deduped.length - 1];
        if (!last || last.state !== s.state) deduped.push(s);
    }

    const pairs: ZoneActuationInterval[] = [];
    let pendingOn: Date | null = null;
    for (const s of deduped) {
        if (s.state === 'on') {
            pendingOn = s.lastChanged.getTime() < windowStart.getTime() ? windowStart : s.lastChanged;
        } else if (pendingOn !== null) {
            const offAt = s.lastChanged.getTime() > windowEnd.getTime() ? windowEnd : s.lastChanged;
            pairs.push({ onAt: pendingOn, offAt });
            pendingOn = null;
        }
    }

    if (pendingOn !== null) {
        pairs.push({ onAt: pendingOn, offAt: windowEnd });
    }

    return pairs;
}

async function sendHistoryRequest(endpoint: string, token: string, entityId: string): Promise<HistoryStateRecord[]> {
    let response: Response;
    try {
        response = await fetch(endpoint, {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${token}`,
            },
        });
    } catch (err) {
        console.error(`home-assistant: fetch failed while reading history for ${entityId}.`, err);
        throw err;
    }

    if (response.status === 404) {
        console.warn(`home-assistant: entity ${entityId} returned 404 from history endpoint; treating as no actuations.`);
        return [];
    }

    if (!response.ok) {
        const message = `home-assistant: history_period on ${entityId} failed: ${response.status} ${response.statusText}`;
        console.error(message);
        throw new HttpResponseError(response.status, response.statusText, message);
    }

    const body = await response.json() as Array<Array<{ state?: unknown; last_changed?: unknown }>>;
    const rows = body[0] ?? [];
    const parsed: HistoryStateRecord[] = [];
    for (const row of rows) {
        if (typeof row.state !== 'string') continue;
        if (typeof row.last_changed !== 'string') continue;
        const lastChanged = new Date(row.last_changed);
        if (Number.isNaN(lastChanged.getTime())) continue;
        parsed.push({ state: row.state, lastChanged });
    }
    return parsed;
}

function buildHistoryUrl(baseUrl: string, entityId: string, since: Date, until: Date): string {
    const trimmed = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    const url = new URL(`${trimmed}/api/history/period/${since.toISOString()}`);
    url.searchParams.set('filter_entity_id', entityId);
    url.searchParams.set('end_time', until.toISOString());
    url.searchParams.set('minimal_response', '');
    return url.toString();
}
