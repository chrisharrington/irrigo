import { act, renderHook } from '@testing-library/react-native';
import { buildApiWrapper, jsonResponse } from '@/api/test-utils';
import { keys } from '@/api/query-keys';
import { useReplan } from '.';

const mockFetch = jest.fn();

beforeEach(() => {
    (global as { fetch: typeof fetch }).fetch = mockFetch as unknown as typeof fetch;
    mockFetch.mockReset();
    process.env.EXPO_PUBLIC_API_BASE_URL = 'http://test.local:9753';
});

describe('useReplan', () => {
    it('POSTs /replan and invalidates system, next-run, zones, and schedules.', async () => {
        mockFetch.mockResolvedValueOnce(jsonResponse({ status: 'replanned', lastRePlanAt: '2026-05-22T03:00:00.000Z' }));

        const { wrapper, client } = buildApiWrapper();
        client.setQueryData(keys.system.state(), { irrigationEnabled: true, since: 'x' });
        client.setQueryData(keys.nextRun.summary(), { state: 'idle' });
        client.setQueryData(keys.zones.list(), []);
        client.setQueryData(keys.schedules.list(), []);

        const { result } = renderHook(() => useReplan(), { wrapper });

        await act(async () => {
            await result.current.mutateAsync();
        });

        expect((mockFetch.mock.calls[0] as [string, RequestInit])[0]).toBe('http://test.local:9753/replan');
        expect(client.getQueryState(keys.system.state())?.isInvalidated).toBe(true);
        expect(client.getQueryState(keys.nextRun.summary())?.isInvalidated).toBe(true);
        expect(client.getQueryState(keys.zones.list())?.isInvalidated).toBe(true);
        expect(client.getQueryState(keys.schedules.list())?.isInvalidated).toBe(true);
    });
});
