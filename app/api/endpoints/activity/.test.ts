import { jsonResponse } from '@/api/test-helpers';
import { getActivity } from '.';

const mockFetch = jest.fn();

beforeEach(() => {
    (global as { fetch: typeof fetch }).fetch = mockFetch as unknown as typeof fetch;
    mockFetch.mockReset();
    process.env.EXPO_PUBLIC_API_BASE_URL = 'http://test.local:9753';
});

function lastUrl(): URL {
    const raw = (mockFetch.mock.calls.at(-1) as [string, RequestInit])[0];
    return new URL(raw);
}

describe('getActivity', () => {
    it('GETs /activity with no query string when no params are passed.', async () => {
        mockFetch.mockResolvedValueOnce(jsonResponse({ activity: [], nextCursor: null }));

        await getActivity();
        const raw = (mockFetch.mock.calls.at(-1) as [string, RequestInit])[0];
        expect(raw).toBe('http://test.local:9753/activity');
    });

    it('appends zoneId, limit, and cursor query params when provided.', async () => {
        mockFetch.mockResolvedValueOnce(jsonResponse({ activity: [], nextCursor: null }));

        await getActivity({ zoneId: 'z-1', limit: 25, cursor: 'opaque-cursor' });
        const url = lastUrl();
        expect(url.pathname).toBe('/activity');
        expect(url.searchParams.get('zoneId')).toBe('z-1');
        expect(url.searchParams.get('limit')).toBe('25');
        expect(url.searchParams.get('cursor')).toBe('opaque-cursor');
    });

    it('omits unset params so the api uses its defaults.', async () => {
        mockFetch.mockResolvedValueOnce(jsonResponse({ activity: [], nextCursor: null }));

        await getActivity({ zoneId: 'z-1' });
        const url = lastUrl();
        expect(url.searchParams.get('zoneId')).toBe('z-1');
        expect(url.searchParams.has('limit')).toBe(false);
        expect(url.searchParams.has('cursor')).toBe(false);
    });
});
