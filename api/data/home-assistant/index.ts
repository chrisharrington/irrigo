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
