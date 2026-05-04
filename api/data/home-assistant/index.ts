import type { Zone } from '@/models';

type SwitchService = 'turn_on' | 'turn_off';

type HomeAssistantConfig = {
    url: string;
    token: string;
};

/**
 * Opens (energizes) the relay for the given zone via Home Assistant's
 * `switch.turn_on` service. Throws if the zone has no Home Assistant entity
 * configured, if the HA env vars are missing, or if the service call fails.
 *
 * @param zone - Zone whose relay should be opened.
 * @throws Error when configuration is missing or HA returns a non-2xx response.
 */
export async function openZone(zone: Zone): Promise<void> {
    return callService(zone, 'turn_on');
}

/**
 * Closes (de-energizes) the relay for the given zone via Home Assistant's
 * `switch.turn_off` service. Throws on the same conditions as `openZone`.
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

    console.log(`home-assistant: ${action} zone ${zone.id} (${zone.name}) via ${zone.homeAssistantEntityId}.`);

    let response: Response;
    try {
        response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ entity_id: zone.homeAssistantEntityId }),
        });
    } catch (err) {
        console.error(`home-assistant: fetch failed while attempting to ${service} ${zone.homeAssistantEntityId}.`, err);
        throw err;
    }

    if (!response.ok) {
        const message = `home-assistant: ${service} on ${zone.homeAssistantEntityId} failed: ${response.status} ${response.statusText}`;
        console.error(message);
        throw new Error(message);
    }
}

function readConfig(): HomeAssistantConfig {
    const url = process.env.HA_URL;
    const token = process.env.HA_TOKEN;
    if (!url) throw new Error('home-assistant: HA_URL environment variable is required.');
    if (!token) throw new Error('home-assistant: HA_TOKEN environment variable is required.');
    return { url, token };
}

function buildServiceUrl(baseUrl: string, service: SwitchService): string {
    const trimmed = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    return `${trimmed}/api/services/switch/${service}`;
}
