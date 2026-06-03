import type { Zone } from '@/models';
import { HttpResponseError, retry } from './retry';
import { readConfig, readRetryConfig, type SwitchService } from './config';

/**
 * Resolved switch state for a zone's relay. `'unknown'` covers the cases
 * where HA can answer at all but doesn't know the entity (404) or reports
 * a transient state like `unavailable` — the caller should treat it as
 * "don't touch" rather than as a definitive on/off signal.
 */
export type ZoneRelayState = 'on' | 'off' | 'unknown';

/**
 * Opens (energizes) the relay for the given zone via Home Assistant's
 * `switch.turn_on` service. Throws if the zone has no Home Assistant entity
 * configured, if the HA env vars are missing, or if the service call fails
 * after exhausting retries.
 *
 * @param zone - Zone whose relay should be opened.
 * @throws Error when configuration is missing or HA returns a non-2xx response.
 */
export async function openZone(zone: Zone): Promise<void> {
    return callService(zone, 'turn_on');
}

/**
 * Closes (de-energizes) the relay for the given zone via Home Assistant's
 * `switch.turn_off` service. Throws on the same conditions as `openZone`. The
 * close-side retry budget is twice the open-side budget — closing a stuck-on
 * relay matters more than opening one.
 *
 * @param zone - Zone whose relay should be closed.
 * @throws Error when configuration is missing or HA returns a non-2xx response.
 */
export async function closeZone(zone: Zone): Promise<void> {
    return callService(zone, 'turn_off');
}

/**
 * Reads the current on/off state of a zone's relay from Home Assistant via
 * `GET /api/states/<entity_id>`. Returns `'unknown'` rather than throwing
 * for the soft-failure cases (zone not configured, entity missing in HA,
 * unrecognized state string) so callers like the boot-time reconciler can
 * treat them as "don't touch" without a try/catch. Network or 5xx errors
 * propagate after the read-side retry budget is exhausted.
 *
 * @param zone - Zone whose relay state should be queried.
 * @throws Error when the HA env vars are missing or HA returns a 5xx
 *   response after retry exhaustion.
 */
export async function getZoneState(zone: Zone): Promise<ZoneRelayState> {
    if (!zone.homeAssistantEntityId) {
        console.warn(`home-assistant: zone ${zone.id} (${zone.name}) has no homeAssistantEntityId; cannot read state.`);
        return 'unknown';
    }

    const { url, token } = readConfig();
    const entityId = zone.homeAssistantEntityId;
    const endpoint = buildStateUrl(url, entityId);

    console.log(`home-assistant: reading state for zone ${zone.id} (${zone.name}) via ${entityId}.`);

    const retryConfig = readRetryConfig();
    return retry(
        () => sendStateRequest(endpoint, token, entityId),
        {
            maxAttempts: retryConfig.maxAttempts,
            baseMs: retryConfig.baseMs,
            operation: 'get_state',
            entityId,
        },
    );
}

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

async function sendStateRequest(endpoint: string, token: string, entityId: string): Promise<ZoneRelayState> {
    let response: Response;
    try {
        response = await fetch(endpoint, {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${token}`,
            },
        });
    } catch (err) {
        console.error(`home-assistant: fetch failed while reading state of ${entityId}.`, err);
        throw err;
    }

    if (response.status === 404) {
        console.warn(`home-assistant: entity ${entityId} returned 404; treating as unknown.`);
        return 'unknown';
    }

    if (!response.ok) {
        const message = `home-assistant: get_state on ${entityId} failed: ${response.status} ${response.statusText}`;
        console.error(message);
        throw new HttpResponseError(response.status, response.statusText, message);
    }

    const body = await response.json() as { state?: unknown };
    if (body.state === 'on') return 'on';
    if (body.state === 'off') return 'off';
    return 'unknown';
}

async function callService(zone: Zone, service: SwitchService): Promise<void> {
    if (!zone.homeAssistantEntityId)
        throw new Error(`home-assistant: zone ${zone.id} (${zone.name}) has no homeAssistantEntityId; cannot ${service}.`);

    const { url, token } = readConfig();
    const endpoint = buildServiceUrl(url, service);
    const action = service === 'turn_on' ? 'open' : 'close';
    const entityId = zone.homeAssistantEntityId;

    console.log(`home-assistant: ${action} zone ${zone.id} (${zone.name}) via ${entityId}.`);

    const retryConfig = readRetryConfig();
    const maxAttempts = service === 'turn_off' ? retryConfig.maxAttempts * 2 : retryConfig.maxAttempts;

    await retry(
        () => sendRequest(endpoint, token, entityId, service),
        {
            maxAttempts,
            baseMs: retryConfig.baseMs,
            operation: service,
            entityId,
        },
    );
}

async function sendRequest(endpoint: string, token: string, entityId: string, service: SwitchService): Promise<void> {
    let response: Response;
    try {
        response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ entity_id: entityId }),
        });
    } catch (err) {
        console.error(`home-assistant: fetch failed while attempting to ${service} ${entityId}.`, err);
        throw err;
    }

    if (!response.ok) {
        const message = `home-assistant: ${service} on ${entityId} failed: ${response.status} ${response.statusText}`;
        console.error(message);
        throw new HttpResponseError(response.status, response.statusText, message);
    }
}

function buildServiceUrl(baseUrl: string, service: SwitchService): string {
    const trimmed = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    return `${trimmed}/api/services/switch/${service}`;
}

function buildStateUrl(baseUrl: string, entityId: string): string {
    const trimmed = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    return `${trimmed}/api/states/${encodeURIComponent(entityId)}`;
}

function buildHistoryUrl(baseUrl: string, entityId: string, since: Date, until: Date): string {
    const trimmed = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    const url = new URL(`${trimmed}/api/history/period/${since.toISOString()}`);
    url.searchParams.set('filter_entity_id', entityId);
    url.searchParams.set('end_time', until.toISOString());
    url.searchParams.set('minimal_response', '');
    return url.toString();
}
