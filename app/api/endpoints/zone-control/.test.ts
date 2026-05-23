import { jsonResponse } from '@/api/test-helpers';
import { closeZone, openZone, runZone } from '.';

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

describe('openZone', () => {
    it('POSTs to /zones/:id/open with URI-escaped id.', async () => {
        mockFetch.mockResolvedValueOnce(jsonResponse({ status: 'open', since: '2026-05-22T00:00:00.000Z' }));

        await openZone('zone with spaces');
        const { url, init } = lastCall();
        expect(url).toBe('http://test.local:9753/zones/zone%20with%20spaces/open');
        expect(init.method).toBe('POST');
    });
});

describe('closeZone', () => {
    it('POSTs to /zones/:id/close.', async () => {
        mockFetch.mockResolvedValueOnce(jsonResponse({ status: 'closed' }));

        await closeZone('z-1');
        expect(lastCall().url).toBe('http://test.local:9753/zones/z-1/close');
    });
});

describe('runZone', () => {
    it('POSTs to /zones/:id/run with the durationMin in the body.', async () => {
        mockFetch.mockResolvedValueOnce(jsonResponse({ status: 'open', since: '...', willCloseAt: '...' }));

        await runZone('z-1', 15);
        const { url, init } = lastCall();
        expect(url).toBe('http://test.local:9753/zones/z-1/run');
        expect(init.method).toBe('POST');
        expect(JSON.parse(init.body as string)).toEqual({ durationMin: 15 });
    });
});
