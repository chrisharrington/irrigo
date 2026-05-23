import { act, renderHook, waitFor } from '@testing-library/react-native';
import { buildApiWrapper, jsonResponse } from '@/api/test-utils';
import { useActivity } from '.';

const mockFetch = jest.fn();

beforeEach(() => {
    (global as { fetch: typeof fetch }).fetch = mockFetch as unknown as typeof fetch;
    mockFetch.mockReset();
    process.env.EXPO_PUBLIC_API_BASE_URL = 'http://test.local:9753';
});

describe('useActivity', () => {
    it('fetches the first page from /activity with no cursor.', async () => {
        mockFetch.mockResolvedValueOnce(jsonResponse({
            activity: [{ id: 'a-1', date: '2026-05-22', zone: { id: 'z-1', name: 'N', slug: 'n' }, appliedDepthMm: 5, durationMin: 30, depletionBeforeMm: 12, depletionAfterMm: 7, source: 'planner' }],
            nextCursor: 'cursor-2',
        }));

        const { result } = renderHook(() => useActivity(), { wrapper: buildApiWrapper().wrapper });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.data?.pages[0]?.activity[0]?.id).toBe('a-1');
        const url = new URL((mockFetch.mock.calls[0] as [string, RequestInit])[0]);
        expect(url.pathname).toBe('/activity');
        expect(url.searchParams.has('cursor')).toBe(false);
    });

    it('passes zoneId in the query string when filtering by zone.', async () => {
        mockFetch.mockResolvedValueOnce(jsonResponse({ activity: [], nextCursor: null }));

        const { result } = renderHook(() => useActivity({ zoneId: 'z-1' }), { wrapper: buildApiWrapper().wrapper });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        const url = new URL((mockFetch.mock.calls[0] as [string, RequestInit])[0]);
        expect(url.searchParams.get('zoneId')).toBe('z-1');
    });

    it('fetchNextPage uses the prior page nextCursor and stops when null.', async () => {
        mockFetch.mockResolvedValueOnce(jsonResponse({ activity: [{ id: 'a-1' }], nextCursor: 'cursor-2' }));
        mockFetch.mockResolvedValueOnce(jsonResponse({ activity: [{ id: 'a-2' }], nextCursor: null }));

        const { result } = renderHook(() => useActivity(), { wrapper: buildApiWrapper().wrapper });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.hasNextPage).toBe(true);

        await act(async () => {
            await result.current.fetchNextPage();
        });

        await waitFor(() => expect(result.current.data?.pages.length).toBe(2));
        expect(result.current.hasNextPage).toBe(false);
        const secondUrl = new URL((mockFetch.mock.calls[1] as [string, RequestInit])[0]);
        expect(secondUrl.searchParams.get('cursor')).toBe('cursor-2');
    });
});
