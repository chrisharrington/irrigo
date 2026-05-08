import type { Zone } from '@/models';
import { HttpResponseError, retry } from './retry';

type SwitchService = 'turn_on' | 'turn_off';

type HomeAssistantConfig = {
    url: string;
    token: string;
};

type RetryConfig = {
    maxAttempts: number;
    baseMs: number;
};

const DEFAULT_RETRY_MAX = 3;
const DEFAULT_RETRY_BASE_MS = 1000;

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

function readConfig(): HomeAssistantConfig {
    const url = process.env.HA_URL;
    const token = process.env.HA_TOKEN;
    if (!url) throw new Error('home-assistant: HA_URL environment variable is required.');
    if (!token) throw new Error('home-assistant: HA_TOKEN environment variable is required.');
    return { url, token };
}

function readRetryConfig(): RetryConfig {
    return {
        maxAttempts: parsePositiveInt(process.env.HA_RETRY_MAX, DEFAULT_RETRY_MAX),
        baseMs: parseNonNegativeInt(process.env.HA_RETRY_BASE_MS, DEFAULT_RETRY_BASE_MS),
    };
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
    if (raw === undefined) return fallback;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed >= 1 ? parsed : fallback;
}

function parseNonNegativeInt(raw: string | undefined, fallback: number): number {
    if (raw === undefined) return fallback;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function buildServiceUrl(baseUrl: string, service: SwitchService): string {
    const trimmed = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    return `${trimmed}/api/services/switch/${service}`;
}

function buildStateUrl(baseUrl: string, entityId: string): string {
    const trimmed = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    return `${trimmed}/api/states/${encodeURIComponent(entityId)}`;
}
