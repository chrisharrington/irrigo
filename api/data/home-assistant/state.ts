import type { Zone } from '@/models';
import { HttpResponseError, retry } from './retry';
import { readConfig, readRetryConfig } from './config';

/**
 * Resolved switch state for a zone's relay. `'unknown'` covers the cases
 * where HA can answer at all but doesn't know the entity (404) or reports
 * a transient state like `unavailable` — the caller should treat it as
 * "don't touch" rather than as a definitive on/off signal.
 */
export type ZoneRelayState = 'on' | 'off' | 'unknown';

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

function buildStateUrl(baseUrl: string, entityId: string): string {
    const trimmed = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    return `${trimmed}/api/states/${encodeURIComponent(entityId)}`;
}
