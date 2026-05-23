import { act, renderHook, waitFor } from '@testing-library/react-native';
import { buildApiWrapper, jsonResponse } from '@/api/test-utils';
import { keys } from '@/api/query-keys';
import { useSetSystemEnabled, useSystem } from '.';

const mockFetch = jest.fn();

beforeEach(() => {
    (global as { fetch: typeof fetch }).fetch = mockFetch as unknown as typeof fetch;
    mockFetch.mockReset();
    process.env.EXPO_PUBLIC_API_BASE_URL = 'http://test.local:9753';
});

describe('useSystem', () => {
    it('fetches and exposes the system state.', async () => {
        mockFetch.mockResolvedValueOnce(jsonResponse({ irrigationEnabled: true, since: '2026-05-22T00:00:00.000Z' }));

        const { result } = renderHook(() => useSystem(), { wrapper: buildApiWrapper().wrapper });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.data?.irrigationEnabled).toBe(true);
    });
});

describe('useSetSystemEnabled', () => {
    it('POSTs /system/enable when called with true.', async () => {
        mockFetch.mockResolvedValueOnce(jsonResponse({ irrigationEnabled: true, since: '2026-05-22T00:00:00.000Z' }));

        const { result } = renderHook(() => useSetSystemEnabled(), { wrapper: buildApiWrapper().wrapper });

        await act(async () => {
            await result.current.mutateAsync(true);
        });

        const [calledUrl, init] = mockFetch.mock.calls[0] as [string, RequestInit];
        expect(calledUrl).toBe('http://test.local:9753/system/enable');
        expect(init.method).toBe('POST');
    });

    it('POSTs /system/disable when called with false.', async () => {
        mockFetch.mockResolvedValueOnce(jsonResponse({ irrigationEnabled: false, since: '2026-05-22T01:00:00.000Z' }));

        const { result } = renderHook(() => useSetSystemEnabled(), { wrapper: buildApiWrapper().wrapper });

        await act(async () => {
            await result.current.mutateAsync(false);
        });

        expect((mockFetch.mock.calls[0] as [string, RequestInit])[0]).toBe('http://test.local:9753/system/disable');
    });

    it('invalidates system, tonight, zones, and schedules after a successful flip.', async () => {
        mockFetch.mockResolvedValueOnce(jsonResponse({ irrigationEnabled: true, since: '2026-05-22T00:00:00.000Z' }));

        const { wrapper, client } = buildApiWrapper();
        // Seed the cache so we can observe invalidation.
        client.setQueryData(keys.system.state(), { irrigationEnabled: false, since: 'x' });
        client.setQueryData(keys.tonight.summary(), { state: 'idle' });
        client.setQueryData(keys.zones.list(), []);
        client.setQueryData(keys.schedules.list(), []);

        const { result } = renderHook(() => useSetSystemEnabled(), { wrapper });

        await act(async () => {
            await result.current.mutateAsync(true);
        });

        expect(client.getQueryState(keys.system.state())?.isInvalidated).toBe(true);
        expect(client.getQueryState(keys.tonight.summary())?.isInvalidated).toBe(true);
        expect(client.getQueryState(keys.zones.list())?.isInvalidated).toBe(true);
        expect(client.getQueryState(keys.schedules.list())?.isInvalidated).toBe(true);
    });
});
