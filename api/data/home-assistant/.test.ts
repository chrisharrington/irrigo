import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { createTestZone } from '@/mock/zone';
import { closeZone, openZone } from '.';

const mockFetch = mock(() => Promise.resolve({} as Response));
(global as any).fetch = mockFetch;

const ENTITY_ID = 'switch.sonoff_4chpro_relay_1';
const HA_URL = 'http://ha.local:8123';
const HA_TOKEN = 'test-token-123';

describe('Home Assistant client', () => {
    let originalUrl: string | undefined;
    let originalToken: string | undefined;

    beforeEach(() => {
        originalUrl = process.env.HA_URL;
        originalToken = process.env.HA_TOKEN;
        process.env.HA_URL = HA_URL;
        process.env.HA_TOKEN = HA_TOKEN;
        mockFetch.mockClear();
        mockFetch.mockResolvedValue({ ok: true, status: 200, statusText: 'OK' } as Response);
    });

    afterEach(() => {
        if (originalUrl === undefined) delete process.env.HA_URL;
        else process.env.HA_URL = originalUrl;

        if (originalToken === undefined) delete process.env.HA_TOKEN;
        else process.env.HA_TOKEN = originalToken;
    });

    describe('openZone', () => {
        it('POSTs to /api/services/switch/turn_on with bearer auth and JSON entity_id body', async () => {
            const zone = createTestZone({ homeAssistantEntityId: ENTITY_ID });

            await openZone(zone);

            expect(mockFetch).toHaveBeenCalledTimes(1);
            const [calledUrl, init] = mockFetch.mock.calls[0] as [string, RequestInit];
            expect(calledUrl).toBe(`${HA_URL}/api/services/switch/turn_on`);
            expect(init.method).toBe('POST');
            expect((init.headers as Record<string, string>)['Authorization']).toBe(`Bearer ${HA_TOKEN}`);
            expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
            expect(JSON.parse(init.body as string)).toEqual({ entity_id: ENTITY_ID });
        });

        it('throws when Home Assistant returns a non-2xx response', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 401,
                statusText: 'Unauthorized',
            } as Response);
            const zone = createTestZone({ homeAssistantEntityId: ENTITY_ID });

            await expect(openZone(zone)).rejects.toThrow(/turn_on on switch\.sonoff_4chpro_relay_1 failed: 401 Unauthorized/);
        });

        it('throws when fetch rejects with a network error', async () => {
            mockFetch.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));
            const zone = createTestZone({ homeAssistantEntityId: ENTITY_ID });

            await expect(openZone(zone)).rejects.toThrow('connect ECONNREFUSED');
        });

        it('throws when the zone has no homeAssistantEntityId', async () => {
            const zone = createTestZone({ homeAssistantEntityId: undefined });

            await expect(openZone(zone)).rejects.toThrow(/has no homeAssistantEntityId/);
            expect(mockFetch).not.toHaveBeenCalled();
        });
    });

    describe('closeZone', () => {
        it('POSTs to /api/services/switch/turn_off with bearer auth and JSON entity_id body', async () => {
            const zone = createTestZone({ homeAssistantEntityId: ENTITY_ID });

            await closeZone(zone);

            expect(mockFetch).toHaveBeenCalledTimes(1);
            const [calledUrl, init] = mockFetch.mock.calls[0] as [string, RequestInit];
            expect(calledUrl).toBe(`${HA_URL}/api/services/switch/turn_off`);
            expect(init.method).toBe('POST');
            expect((init.headers as Record<string, string>)['Authorization']).toBe(`Bearer ${HA_TOKEN}`);
            expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
            expect(JSON.parse(init.body as string)).toEqual({ entity_id: ENTITY_ID });
        });

        it('throws when Home Assistant returns a non-2xx response', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 500,
                statusText: 'Internal Server Error',
            } as Response);
            const zone = createTestZone({ homeAssistantEntityId: ENTITY_ID });

            await expect(closeZone(zone)).rejects.toThrow(/turn_off on switch\.sonoff_4chpro_relay_1 failed: 500 Internal Server Error/);
        });

        it('throws when fetch rejects with a network error', async () => {
            mockFetch.mockRejectedValueOnce(new Error('socket hang up'));
            const zone = createTestZone({ homeAssistantEntityId: ENTITY_ID });

            await expect(closeZone(zone)).rejects.toThrow('socket hang up');
        });

        it('throws when the zone has no homeAssistantEntityId', async () => {
            const zone = createTestZone({ homeAssistantEntityId: undefined });

            await expect(closeZone(zone)).rejects.toThrow(/has no homeAssistantEntityId/);
            expect(mockFetch).not.toHaveBeenCalled();
        });
    });

    describe('configuration', () => {
        it('strips a trailing slash on HA_URL when building the service endpoint', async () => {
            process.env.HA_URL = `${HA_URL}/`;
            const zone = createTestZone({ homeAssistantEntityId: ENTITY_ID });

            await openZone(zone);

            const [calledUrl] = mockFetch.mock.calls[0] as [string];
            expect(calledUrl).toBe(`${HA_URL}/api/services/switch/turn_on`);
        });

        it('throws when HA_URL is unset', async () => {
            delete process.env.HA_URL;
            const zone = createTestZone({ homeAssistantEntityId: ENTITY_ID });

            await expect(openZone(zone)).rejects.toThrow(/HA_URL environment variable is required/);
            expect(mockFetch).not.toHaveBeenCalled();
        });

        it('throws when HA_TOKEN is unset', async () => {
            delete process.env.HA_TOKEN;
            const zone = createTestZone({ homeAssistantEntityId: ENTITY_ID });

            await expect(closeZone(zone)).rejects.toThrow(/HA_TOKEN environment variable is required/);
            expect(mockFetch).not.toHaveBeenCalled();
        });
    });
});
