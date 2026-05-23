import { renderHook, waitFor } from '@testing-library/react-native';
import { buildApiWrapper, jsonResponse } from '@/api/test-utils';
import { useZones } from '.';

const mockFetch = jest.fn();

beforeEach(() => {
    (global as { fetch: typeof fetch }).fetch = mockFetch as unknown as typeof fetch;
    mockFetch.mockReset();
    process.env.EXPO_PUBLIC_API_BASE_URL = 'http://test.local:9753';
});

describe('useZones', () => {
    it('fetches /zones and exposes the unwrapped zone array.', async () => {
        mockFetch.mockResolvedValueOnce(jsonResponse({
            zones: [
                { id: 'z-1', slug: 'north', name: 'North' },
                { id: 'z-2', slug: 'south', name: 'South' },
            ],
        }));

        const { result } = renderHook(() => useZones(), { wrapper: buildApiWrapper().wrapper });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.data?.map(z => z.name)).toEqual(['North', 'South']);
    });

    it('surfaces an ApiError on a non-2xx response.', async () => {
        mockFetch.mockResolvedValueOnce(jsonResponse({ error: 'not-found', message: 'no zones' }, 404));

        const { result } = renderHook(() => useZones(), { wrapper: buildApiWrapper().wrapper });

        await waitFor(() => expect(result.current.isError).toBe(true));
        expect(result.current.error?.status).toBe(404);
        expect(result.current.error?.code).toBe('not-found');
    });
});
