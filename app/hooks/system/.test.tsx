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

    it('invalidates system, next-run, zones, and schedules after a successful flip.', async () => {
        mockFetch.mockResolvedValueOnce(jsonResponse({ irrigationEnabled: true, since: '2026-05-22T00:00:00.000Z' }));

        const { wrapper, client } = buildApiWrapper();
        // Seed the cache so we can observe invalidation.
        client.setQueryData(keys.system.state(), { irrigationEnabled: false, since: 'x' });
        client.setQueryData(keys.nextRun.summary(), { state: 'idle' });
        client.setQueryData(keys.zones.list(), []);
        client.setQueryData(keys.schedules.list(), []);

        const { result } = renderHook(() => useSetSystemEnabled(), { wrapper });

        await act(async () => {
            await result.current.mutateAsync(true);
        });

        expect(client.getQueryState(keys.system.state())?.isInvalidated).toBe(true);
        expect(client.getQueryState(keys.nextRun.summary())?.isInvalidated).toBe(true);
        expect(client.getQueryState(keys.zones.list())?.isInvalidated).toBe(true);
        expect(client.getQueryState(keys.schedules.list())?.isInvalidated).toBe(true);
    });

    it('writes the optimistic system state into the cache synchronously on mutate.', async () => {
        // Fetch never resolves so the mutation stays in-flight; the
        // optimistic cache write should be observable immediately.
        mockFetch.mockImplementation(() => new Promise(() => {}));

        const { wrapper, client } = buildApiWrapper();
        client.setQueryData(keys.system.state(), { irrigationEnabled: false, since: 'old' });

        const { result } = renderHook(() => useSetSystemEnabled(), { wrapper });

        act(() => {
            result.current.mutate(true);
        });

        await waitFor(() => {
            const cached = client.getQueryData<{ irrigationEnabled: boolean; since: string }>(
                keys.system.state(),
            );
            expect(cached?.irrigationEnabled).toBe(true);
            expect(cached?.since).not.toBe('old');
        });
    });

    it('rolls the system cache back to the previous value when the mutation rejects.', async () => {
        mockFetch.mockResolvedValueOnce(jsonResponse({ error: 'HA 502' }, 502));

        const { wrapper, client } = buildApiWrapper();
        client.setQueryData(keys.system.state(), { irrigationEnabled: false, since: 'old' });

        const { result } = renderHook(() => useSetSystemEnabled(), { wrapper });

        await act(async () => {
            await result.current.mutateAsync(true).catch(() => undefined);
        });

        expect(result.current.isError).toBe(true);
        // Cache restored to the snapshot taken before the optimistic write.
        expect(client.getQueryData(keys.system.state())).toEqual({
            irrigationEnabled: false,
            since: 'old',
        });
    });

    it('still invalidates system, next-run, zones, and schedules after a failed flip.', async () => {
        mockFetch.mockResolvedValueOnce(jsonResponse({ error: 'HA 502' }, 502));

        const { wrapper, client } = buildApiWrapper();
        client.setQueryData(keys.system.state(), { irrigationEnabled: false, since: 'x' });
        client.setQueryData(keys.nextRun.summary(), { state: 'idle' });
        client.setQueryData(keys.zones.list(), []);
        client.setQueryData(keys.schedules.list(), []);

        const { result } = renderHook(() => useSetSystemEnabled(), { wrapper });

        await act(async () => {
            await result.current.mutateAsync(true).catch(() => undefined);
        });

        expect(client.getQueryState(keys.system.state())?.isInvalidated).toBe(true);
        expect(client.getQueryState(keys.nextRun.summary())?.isInvalidated).toBe(true);
        expect(client.getQueryState(keys.zones.list())?.isInvalidated).toBe(true);
        expect(client.getQueryState(keys.schedules.list())?.isInvalidated).toBe(true);
    });
});
