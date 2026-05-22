import { ApiError, apiFetch, getApiBaseUrl } from '.';

describe('getApiBaseUrl', () => {
    const ORIGINAL = process.env.EXPO_PUBLIC_API_BASE_URL;

    afterEach(() => {
        if (ORIGINAL === undefined) delete process.env.EXPO_PUBLIC_API_BASE_URL;
        else process.env.EXPO_PUBLIC_API_BASE_URL = ORIGINAL;
    });

    it('falls back to localhost when EXPO_PUBLIC_API_BASE_URL is unset.', () => {
        delete process.env.EXPO_PUBLIC_API_BASE_URL;
        expect(getApiBaseUrl()).toBe('http://localhost:9753');
    });

    it('falls back to localhost when EXPO_PUBLIC_API_BASE_URL is empty.', () => {
        process.env.EXPO_PUBLIC_API_BASE_URL = '';
        expect(getApiBaseUrl()).toBe('http://localhost:9753');
    });

    it('uses EXPO_PUBLIC_API_BASE_URL verbatim when set.', () => {
        process.env.EXPO_PUBLIC_API_BASE_URL = 'http://192.168.2.100:9753';
        expect(getApiBaseUrl()).toBe('http://192.168.2.100:9753');
    });

    it('strips a single trailing slash so path joining always yields a single `/`.', () => {
        process.env.EXPO_PUBLIC_API_BASE_URL = 'http://192.168.2.100:9753/';
        expect(getApiBaseUrl()).toBe('http://192.168.2.100:9753');
    });
});

describe('apiFetch', () => {
    const mockFetch = jest.fn();
    const ORIGINAL_BASE = process.env.EXPO_PUBLIC_API_BASE_URL;

    beforeEach(() => {
        (global as { fetch: typeof fetch }).fetch = mockFetch as unknown as typeof fetch;
        mockFetch.mockReset();
        process.env.EXPO_PUBLIC_API_BASE_URL = 'http://test.local:9753';
    });

    afterAll(() => {
        if (ORIGINAL_BASE === undefined) delete process.env.EXPO_PUBLIC_API_BASE_URL;
        else process.env.EXPO_PUBLIC_API_BASE_URL = ORIGINAL_BASE;
    });

    function jsonResponse(status: number, body: unknown): Response {
        return new Response(JSON.stringify(body), {
            status,
            headers: { 'content-type': 'application/json' },
        });
    }

    it('joins the base URL with the path and returns the parsed JSON body.', async () => {
        mockFetch.mockResolvedValueOnce(jsonResponse(200, { irrigationEnabled: true, since: '2026-05-22T00:00:00.000Z' }));

        const result = await apiFetch<{ irrigationEnabled: boolean }>('/system');

        expect(mockFetch).toHaveBeenCalledTimes(1);
        const [calledUrl, init] = mockFetch.mock.calls[0] as [string, RequestInit];
        expect(calledUrl).toBe('http://test.local:9753/system');
        expect(init.method).toBeUndefined();
        expect(result.irrigationEnabled).toBe(true);
    });

    it('sets Content-Type: application/json on requests with a body, and Accept always.', async () => {
        mockFetch.mockResolvedValueOnce(jsonResponse(200, { status: 'registered' }));

        await apiFetch('/push/register', {
            method: 'POST',
            body: JSON.stringify({ token: 'tok-1', platform: 'ios' }),
        });

        const init = mockFetch.mock.calls[0]![1] as RequestInit;
        const headers = init.headers as Headers;
        expect(headers.get('Content-Type')).toBe('application/json');
        expect(headers.get('Accept')).toBe('application/json');
    });

    it('does not set Content-Type when no body is sent.', async () => {
        mockFetch.mockResolvedValueOnce(jsonResponse(200, {}));

        await apiFetch('/system/enable', { method: 'POST' });

        const init = mockFetch.mock.calls[0]![1] as RequestInit;
        const headers = init.headers as Headers;
        expect(headers.get('Content-Type')).toBeNull();
        expect(headers.get('Accept')).toBe('application/json');
    });

    it('returns undefined for 204 No Content responses.', async () => {
        mockFetch.mockResolvedValueOnce(new Response(null, { status: 204 }));

        const result = await apiFetch<void>('/something');

        expect(result).toBeUndefined();
    });

    it('throws ApiError with the parsed code and message on a 400.', async () => {
        mockFetch.mockResolvedValueOnce(
            jsonResponse(400, { error: 'bad-request', message: 'durationMin must be a positive number.' }),
        );

        await expect(apiFetch('/zones/z-1/run', { method: 'POST', body: '{}' })).rejects.toMatchObject({
            name: 'ApiError',
            status: 400,
            code: 'bad-request',
            message: 'durationMin must be a positive number.',
        });
    });

    it('throws ApiError with the not-found code on a 404.', async () => {
        mockFetch.mockResolvedValueOnce(
            jsonResponse(404, { error: 'not-found', message: 'Zone zone-missing not found.' }),
        );

        await expect(apiFetch('/zones/zone-missing/open', { method: 'POST' })).rejects.toMatchObject({
            status: 404,
            code: 'not-found',
        });
    });

    it('throws ApiError with the busy code on a 409.', async () => {
        mockFetch.mockResolvedValueOnce(
            jsonResponse(409, { error: 'busy', message: 'another fire in flight' }),
        );

        await expect(apiFetch('/zones/z-1/open', { method: 'POST' })).rejects.toMatchObject({
            status: 409,
            code: 'busy',
        });
    });

    it('throws ApiError with the home-assistant code on a 502.', async () => {
        mockFetch.mockResolvedValueOnce(
            jsonResponse(502, { error: 'home-assistant', message: 'HA 503' }),
        );

        await expect(apiFetch('/zones/z-1/open', { method: 'POST' })).rejects.toMatchObject({
            status: 502,
            code: 'home-assistant',
        });
    });

    it('falls back to code "unknown" when the error body is not JSON.', async () => {
        mockFetch.mockResolvedValueOnce(
            new Response('<html>oops</html>', { status: 500, headers: { 'content-type': 'text/html' } }),
        );

        await expect(apiFetch('/anything')).rejects.toMatchObject({
            status: 500,
            code: 'unknown',
        });
    });

    it('throws ApiError with status 0 and code "network" when fetch itself rejects.', async () => {
        mockFetch.mockRejectedValueOnce(new TypeError('Network request failed'));

        const err = await apiFetch('/anything').catch((e: unknown) => e);

        expect(err).toBeInstanceOf(ApiError);
        expect((err as ApiError).status).toBe(0);
        expect((err as ApiError).code).toBe('network');
    });
});
