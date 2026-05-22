import { jsonResponse } from '@/api/test-helpers';
import { replan } from '.';

const mockFetch = jest.fn();

beforeEach(() => {
    (global as { fetch: typeof fetch }).fetch = mockFetch as unknown as typeof fetch;
    mockFetch.mockReset();
    process.env.EXPO_PUBLIC_API_BASE_URL = 'http://test.local:9753';
});

describe('replan', () => {
    it('POSTs /replan.', async () => {
        mockFetch.mockResolvedValueOnce(jsonResponse({ status: 'replanned', lastRePlanAt: '2026-05-22T02:00:00.000Z' }));

        await replan();
        const [url, init] = mockFetch.mock.calls.at(-1) as [string, RequestInit];
        expect(url).toBe('http://test.local:9753/replan');
        expect(init.method).toBe('POST');
    });
});
