import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test';
import { createTestZone } from '@/mock/zone';
import { closeZone, getZoneState, openZone } from '.';
import { HttpResponseError, computeBackoffMs, retry } from './retry';

const mockFetch = mock(() => Promise.resolve({} as Response));
(global as any).fetch = mockFetch;

const ENTITY_ID = 'switch.sonoff_4chpro_relay_1';
const HA_URL = 'http://ha.local:8123';
const HA_TOKEN = 'test-token-123';

describe('Home Assistant client', () => {
    let originalUrl: string | undefined;
    let originalToken: string | undefined;
    let originalRetryMax: string | undefined;
    let originalRetryBaseMs: string | undefined;

    beforeEach(() => {
        originalUrl = process.env.HA_URL;
        originalToken = process.env.HA_TOKEN;
        originalRetryMax = process.env.HA_RETRY_MAX;
        originalRetryBaseMs = process.env.HA_RETRY_BASE_MS;
        process.env.HA_URL = HA_URL;
        process.env.HA_TOKEN = HA_TOKEN;
        process.env.HA_RETRY_MAX = '1';
        process.env.HA_RETRY_BASE_MS = '0';
        mockFetch.mockClear();
        mockFetch.mockResolvedValue({ ok: true, status: 200, statusText: 'OK' } as Response);
    });

    afterEach(() => {
        if (originalUrl === undefined) delete process.env.HA_URL;
        else process.env.HA_URL = originalUrl;

        if (originalToken === undefined) delete process.env.HA_TOKEN;
        else process.env.HA_TOKEN = originalToken;

        if (originalRetryMax === undefined) delete process.env.HA_RETRY_MAX;
        else process.env.HA_RETRY_MAX = originalRetryMax;

        if (originalRetryBaseMs === undefined) delete process.env.HA_RETRY_BASE_MS;
        else process.env.HA_RETRY_BASE_MS = originalRetryBaseMs;
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

        it('throws when Home Assistant returns a non-2xx response after exhausting retries', async () => {
            mockFetch.mockResolvedValue({
                ok: false,
                status: 500,
                statusText: 'Internal Server Error',
            } as Response);
            const zone = createTestZone({ homeAssistantEntityId: ENTITY_ID });

            await expect(closeZone(zone)).rejects.toThrow(/turn_off on switch\.sonoff_4chpro_relay_1 failed: 500 Internal Server Error/);
            expect(mockFetch).toHaveBeenCalledTimes(2);
        });

        it('throws when fetch rejects with a network error after exhausting retries', async () => {
            mockFetch.mockRejectedValue(new Error('socket hang up'));
            const zone = createTestZone({ homeAssistantEntityId: ENTITY_ID });

            await expect(closeZone(zone)).rejects.toThrow('socket hang up');
            expect(mockFetch).toHaveBeenCalledTimes(2);
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

    describe('retry behaviour', () => {
        it('openZone retries a 503 then succeeds when HA returns OK on the second attempt', async () => {
            process.env.HA_RETRY_MAX = '3';
            mockFetch.mockResolvedValueOnce({ ok: false, status: 503, statusText: 'Service Unavailable' } as Response);
            const zone = createTestZone({ homeAssistantEntityId: ENTITY_ID });

            await openZone(zone);

            expect(mockFetch).toHaveBeenCalledTimes(2);
        });

        it('openZone retries a network error then succeeds when fetch resolves on the second attempt', async () => {
            process.env.HA_RETRY_MAX = '3';
            mockFetch.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));
            const zone = createTestZone({ homeAssistantEntityId: ENTITY_ID });

            await openZone(zone);

            expect(mockFetch).toHaveBeenCalledTimes(2);
        });

        it('openZone exhausts after HA_RETRY_MAX attempts on sustained 5xx and throws', async () => {
            process.env.HA_RETRY_MAX = '2';
            mockFetch.mockResolvedValue({ ok: false, status: 500, statusText: 'Internal Server Error' } as Response);
            const zone = createTestZone({ homeAssistantEntityId: ENTITY_ID });

            await expect(openZone(zone)).rejects.toThrow(/turn_on on switch\.sonoff_4chpro_relay_1 failed: 500 Internal Server Error/);
            expect(mockFetch).toHaveBeenCalledTimes(2);
        });

        it('openZone does not retry a 401 response', async () => {
            process.env.HA_RETRY_MAX = '5';
            mockFetch.mockResolvedValue({ ok: false, status: 401, statusText: 'Unauthorized' } as Response);
            const zone = createTestZone({ homeAssistantEntityId: ENTITY_ID });

            await expect(openZone(zone)).rejects.toThrow(/turn_on on switch\.sonoff_4chpro_relay_1 failed: 401 Unauthorized/);
            expect(mockFetch).toHaveBeenCalledTimes(1);
        });

        it('openZone does not retry a 404 response', async () => {
            process.env.HA_RETRY_MAX = '5';
            mockFetch.mockResolvedValue({ ok: false, status: 404, statusText: 'Not Found' } as Response);
            const zone = createTestZone({ homeAssistantEntityId: ENTITY_ID });

            await expect(openZone(zone)).rejects.toThrow(/turn_on on switch\.sonoff_4chpro_relay_1 failed: 404 Not Found/);
            expect(mockFetch).toHaveBeenCalledTimes(1);
        });

        it('closeZone uses double the open-zone retry budget', async () => {
            process.env.HA_RETRY_MAX = '3';
            mockFetch.mockResolvedValue({ ok: false, status: 500, statusText: 'Internal Server Error' } as Response);
            const zone = createTestZone({ homeAssistantEntityId: ENTITY_ID });

            await expect(closeZone(zone)).rejects.toThrow(/turn_off on switch\.sonoff_4chpro_relay_1 failed: 500 Internal Server Error/);
            expect(mockFetch).toHaveBeenCalledTimes(6);
        });

        it('falls back to default of 3 attempts when HA_RETRY_MAX is unset', async () => {
            delete process.env.HA_RETRY_MAX;
            mockFetch.mockResolvedValue({ ok: false, status: 502, statusText: 'Bad Gateway' } as Response);
            const zone = createTestZone({ homeAssistantEntityId: ENTITY_ID });

            await expect(openZone(zone)).rejects.toThrow(/turn_on on switch\.sonoff_4chpro_relay_1 failed: 502 Bad Gateway/);
            expect(mockFetch).toHaveBeenCalledTimes(3);
        });

        it('falls back to default of 3 attempts when HA_RETRY_MAX is non-numeric', async () => {
            process.env.HA_RETRY_MAX = 'not-a-number';
            mockFetch.mockResolvedValue({ ok: false, status: 502, statusText: 'Bad Gateway' } as Response);
            const zone = createTestZone({ homeAssistantEntityId: ENTITY_ID });

            await expect(openZone(zone)).rejects.toThrow(/turn_on on switch\.sonoff_4chpro_relay_1 failed: 502 Bad Gateway/);
            expect(mockFetch).toHaveBeenCalledTimes(3);
        });

        it('falls back to default of 3 attempts when HA_RETRY_MAX is below 1', async () => {
            process.env.HA_RETRY_MAX = '0';
            mockFetch.mockResolvedValue({ ok: false, status: 502, statusText: 'Bad Gateway' } as Response);
            const zone = createTestZone({ homeAssistantEntityId: ENTITY_ID });

            await expect(openZone(zone)).rejects.toThrow(/turn_on on switch\.sonoff_4chpro_relay_1 failed: 502 Bad Gateway/);
            expect(mockFetch).toHaveBeenCalledTimes(3);
        });
    });

    describe('getZoneState', () => {
        const stateResponse = (state: string) => ({
            ok: true,
            status: 200,
            statusText: 'OK',
            json: async () => ({ entity_id: ENTITY_ID, state }),
        }) as unknown as Response;

        it(`returns 'on' when HA reports state='on'`, async () => {
            mockFetch.mockResolvedValueOnce(stateResponse('on'));
            const zone = createTestZone({ homeAssistantEntityId: ENTITY_ID });

            const state = await getZoneState(zone);

            expect(state).toBe('on');
        });

        it(`returns 'off' when HA reports state='off'`, async () => {
            mockFetch.mockResolvedValueOnce(stateResponse('off'));
            const zone = createTestZone({ homeAssistantEntityId: ENTITY_ID });

            const state = await getZoneState(zone);

            expect(state).toBe('off');
        });

        it(`returns 'unknown' for any other state string`, async () => {
            mockFetch.mockResolvedValueOnce(stateResponse('unavailable'));
            const zone = createTestZone({ homeAssistantEntityId: ENTITY_ID });

            const state = await getZoneState(zone);

            expect(state).toBe('unknown');
        });

        it(`returns 'unknown' when HA returns 404`, async () => {
            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 404,
                statusText: 'Not Found',
            } as Response);
            const zone = createTestZone({ homeAssistantEntityId: ENTITY_ID });

            const state = await getZoneState(zone);

            expect(state).toBe('unknown');
            expect(mockFetch).toHaveBeenCalledTimes(1);
        });

        it(`returns 'unknown' when the zone has no homeAssistantEntityId and does not call fetch`, async () => {
            const zone = createTestZone({ homeAssistantEntityId: undefined });

            const state = await getZoneState(zone);

            expect(state).toBe('unknown');
            expect(mockFetch).not.toHaveBeenCalled();
        });

        it('throws after retry exhaustion when HA returns 500', async () => {
            mockFetch.mockResolvedValue({
                ok: false,
                status: 500,
                statusText: 'Internal Server Error',
            } as Response);
            const zone = createTestZone({ homeAssistantEntityId: ENTITY_ID });

            await expect(getZoneState(zone)).rejects.toThrow(/get_state on switch\.sonoff_4chpro_relay_1 failed: 500/);
        });

        it('GETs /api/states/<entity_id> with the bearer token and no body', async () => {
            mockFetch.mockResolvedValueOnce(stateResponse('off'));
            const zone = createTestZone({ homeAssistantEntityId: ENTITY_ID });

            await getZoneState(zone);

            const [calledUrl, init] = mockFetch.mock.calls[0] as [string, RequestInit];
            expect(calledUrl).toBe(`${HA_URL}/api/states/${encodeURIComponent(ENTITY_ID)}`);
            expect(init.method).toBe('GET');
            expect((init.headers as Record<string, string>)['Authorization']).toBe(`Bearer ${HA_TOKEN}`);
            expect(init.body).toBeUndefined();
        });
    });
});

describe('computeBackoffMs', () => {
    it('returns baseMs * 2^attempt for a non-zero base', () => {
        expect(computeBackoffMs(0, 1000)).toBe(1000);
        expect(computeBackoffMs(1, 1000)).toBe(2000);
        expect(computeBackoffMs(2, 1000)).toBe(4000);
        expect(computeBackoffMs(3, 1000)).toBe(8000);
    });

    it('returns 0 when baseMs is 0 regardless of attempt', () => {
        expect(computeBackoffMs(0, 0)).toBe(0);
        expect(computeBackoffMs(5, 0)).toBe(0);
    });
});

describe('retry', () => {
    let warnSpy: ReturnType<typeof spyOn>;
    let errorSpy: ReturnType<typeof spyOn>;

    beforeEach(() => {
        warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
        errorSpy = spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        warnSpy.mockRestore();
        errorSpy.mockRestore();
    });

    const baseOpts = { baseMs: 0, operation: 'turn_on', entityId: ENTITY_ID };

    it('returns the resolved value on first success without logging a retry', async () => {
        const fn = mock(() => Promise.resolve('done'));

        const result = await retry(fn, { ...baseOpts, maxAttempts: 3 });

        expect(result).toBe('done');
        expect(fn).toHaveBeenCalledTimes(1);
        expect(warnSpy).not.toHaveBeenCalled();
    });

    it('retries a 5xx HttpResponseError and succeeds on the second attempt', async () => {
        let calls = 0;
        const fn = mock(() => {
            calls += 1;
            if (calls === 1) return Promise.reject(new HttpResponseError(503, 'Service Unavailable', 'down'));
            return Promise.resolve('ok');
        });

        const result = await retry(fn, { ...baseOpts, maxAttempts: 3 });

        expect(result).toBe('ok');
        expect(fn).toHaveBeenCalledTimes(2);
    });

    it('retries a network error (plain Error) and succeeds on the second attempt', async () => {
        let calls = 0;
        const fn = mock(() => {
            calls += 1;
            if (calls === 1) return Promise.reject(new Error('connect ECONNREFUSED'));
            return Promise.resolve('ok');
        });

        const result = await retry(fn, { ...baseOpts, maxAttempts: 3 });

        expect(result).toBe('ok');
        expect(fn).toHaveBeenCalledTimes(2);
    });

    it('does not retry a 4xx HttpResponseError', async () => {
        const err = new HttpResponseError(401, 'Unauthorized', 'bad token');
        const fn = mock(() => Promise.reject(err));

        await expect(retry(fn, { ...baseOpts, maxAttempts: 3 })).rejects.toBe(err);
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('exhausts after maxAttempts and throws the last underlying error', async () => {
        const errors = [
            new HttpResponseError(500, 'Internal Server Error', 'oops 1'),
            new HttpResponseError(500, 'Internal Server Error', 'oops 2'),
            new HttpResponseError(502, 'Bad Gateway', 'oops 3'),
        ];
        let calls = 0;
        const fn = mock(() => {
            const err = errors[calls];
            calls += 1;
            return Promise.reject(err);
        });

        await expect(retry(fn, { ...baseOpts, maxAttempts: 3 })).rejects.toBe(errors[2]!);
        expect(fn).toHaveBeenCalledTimes(3);
    });

    it('logs a warning for every retry attempt and an error on final exhaustion', async () => {
        const fn = mock(() => Promise.reject(new HttpResponseError(500, 'Internal Server Error', 'down')));

        await expect(retry(fn, { ...baseOpts, maxAttempts: 3 })).rejects.toBeInstanceOf(HttpResponseError);

        expect(warnSpy).toHaveBeenCalledTimes(2);
        expect(errorSpy).toHaveBeenCalledTimes(1);
    });
});
