import { renderHook, waitFor } from '@testing-library/react-native';
import { buildApiWrapper, jsonResponse } from '@/api/test-utils';
import { useZone } from '.';

const mockFetch = jest.fn();

beforeEach(() => {
    (global as { fetch: typeof fetch }).fetch = mockFetch as unknown as typeof fetch;
    mockFetch.mockReset();
    process.env.EXPO_PUBLIC_API_BASE_URL = 'http://test.local:9753';
});

describe('useZone', () => {
    it('returns the zone matching the supplied slug.', async () => {
        mockFetch.mockResolvedValueOnce(jsonResponse({
            zones: [
                { id: 'z-1', slug: 'north', name: 'North' },
                { id: 'z-2', slug: 'south', name: 'South' },
            ],
        }));

        const { result } = renderHook(() => useZone('south'), { wrapper: buildApiWrapper().wrapper });

        await waitFor(() => expect(result.current.isPending).toBe(false));
        expect(result.current.zone?.name).toBe('South');
        expect(result.current.isError).toBe(false);
    });

    it('returns undefined zone when no zone matches the slug.', async () => {
        mockFetch.mockResolvedValueOnce(jsonResponse({
            zones: [
                { id: 'z-1', slug: 'north', name: 'North' },
            ],
        }));

        const { result } = renderHook(() => useZone('east'), { wrapper: buildApiWrapper().wrapper });

        await waitFor(() => expect(result.current.isPending).toBe(false));
        expect(result.current.zone).toBeUndefined();
        expect(result.current.isError).toBe(false);
    });

    it('returns undefined zone when slug is undefined.', async () => {
        mockFetch.mockResolvedValueOnce(jsonResponse({
            zones: [
                { id: 'z-1', slug: 'north', name: 'North' },
            ],
        }));

        const { result } = renderHook(() => useZone(undefined), { wrapper: buildApiWrapper().wrapper });

        await waitFor(() => expect(result.current.isPending).toBe(false));
        expect(result.current.zone).toBeUndefined();
    });

    it('mirrors isPending=true while the underlying /zones query is in flight.', () => {
        mockFetch.mockReturnValueOnce(new Promise(() => {})); // never resolves

        const { result } = renderHook(() => useZone('north'), { wrapper: buildApiWrapper().wrapper });

        expect(result.current.isPending).toBe(true);
        expect(result.current.zone).toBeUndefined();
    });

    it('surfaces an ApiError on a non-2xx /zones response.', async () => {
        mockFetch.mockResolvedValueOnce(jsonResponse({ error: 'not-found', message: 'no zones' }, 404));

        const { result } = renderHook(() => useZone('north'), { wrapper: buildApiWrapper().wrapper });

        await waitFor(() => expect(result.current.isError).toBe(true));
        expect(result.current.error?.status).toBe(404);
        expect(result.current.zone).toBeUndefined();
    });
});
