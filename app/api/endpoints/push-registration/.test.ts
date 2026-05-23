import { jsonResponse } from '@/api/test-helpers';
import { registerPushToken, unregisterPushToken } from '.';

const mockFetch = jest.fn();

beforeEach(() => {
    (global as { fetch: typeof fetch }).fetch = mockFetch as unknown as typeof fetch;
    mockFetch.mockReset();
    process.env.EXPO_PUBLIC_API_BASE_URL = 'http://test.local:9753';
});

function lastCall(): { url: string; init: RequestInit } {
    const [url, init] = mockFetch.mock.calls.at(-1) as [string, RequestInit];
    return { url, init };
}

describe('registerPushToken', () => {
    it('POSTs /push/register with the registration body.', async () => {
        mockFetch.mockResolvedValueOnce(jsonResponse({ status: 'registered' }));

        await registerPushToken({ token: 'tok-1', platform: 'ios', userAgent: 'irrigo/1.0' });
        const { url, init } = lastCall();
        expect(url).toBe('http://test.local:9753/push/register');
        expect(init.method).toBe('POST');
        expect(JSON.parse(init.body as string)).toEqual({ token: 'tok-1', platform: 'ios', userAgent: 'irrigo/1.0' });
    });
});

describe('unregisterPushToken', () => {
    it('POSTs /push/unregister with the token wrapped in an object body.', async () => {
        mockFetch.mockResolvedValueOnce(jsonResponse({ status: 'unregistered' }));

        await unregisterPushToken('tok-1');
        const { url, init } = lastCall();
        expect(url).toBe('http://test.local:9753/push/unregister');
        expect(init.method).toBe('POST');
        expect(JSON.parse(init.body as string)).toEqual({ token: 'tok-1' });
    });
});
