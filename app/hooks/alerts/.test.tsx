import { act, renderHook, waitFor } from '@testing-library/react-native';
import { buildApiWrapper, jsonResponse } from '@/api/test-utils';
import { keys } from '@/api/query-keys';
import { useAckAlert, useAlerts } from '.';

const mockFetch = jest.fn();

beforeEach(() => {
    (global as { fetch: typeof fetch }).fetch = mockFetch as unknown as typeof fetch;
    mockFetch.mockReset();
    process.env.EXPO_PUBLIC_API_BASE_URL = 'http://test.local:9753';
});

describe('useAlerts', () => {
    it('fetches /alerts and exposes the unwrapped array.', async () => {
        mockFetch.mockResolvedValueOnce(jsonResponse({
            alerts: [
                {
                    id: 'a-1', class: 'ha-call-failed', tone: 'danger',
                    title: 'HA close failed', sub: null, when: '2026-05-22T00:00:00.000Z',
                    zoneId: null, ack: false,
                },
            ],
        }));

        const { result } = renderHook(() => useAlerts(), { wrapper: buildApiWrapper().wrapper });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.data?.[0]?.id).toBe('a-1');
    });

    it('returns an empty list when no alerts are active.', async () => {
        mockFetch.mockResolvedValueOnce(jsonResponse({ alerts: [] }));

        const { result } = renderHook(() => useAlerts(), { wrapper: buildApiWrapper().wrapper });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.data).toEqual([]);
    });
});

describe('useAckAlert', () => {
    it('POSTs to /alerts/:id/ack and invalidates the alerts list.', async () => {
        mockFetch.mockResolvedValueOnce(jsonResponse({ status: 'acked' }));

        const { wrapper, client } = buildApiWrapper();
        client.setQueryData(keys.alerts.list(), []);
        const { result } = renderHook(() => useAckAlert(), { wrapper });

        let returned: unknown;
        await act(async () => {
            returned = await result.current.mutateAsync('a-1');
        });

        expect(returned).toBe('acked');
        expect((mockFetch.mock.calls[0] as [string, RequestInit])[0]).toBe('http://test.local:9753/alerts/a-1/ack');
        expect(client.getQueryState(keys.alerts.list())?.isInvalidated).toBe(true);
    });

    it('still resolves with "already-acked" when the alert was already acked.', async () => {
        mockFetch.mockResolvedValueOnce(jsonResponse({ status: 'already-acked' }));

        const { result } = renderHook(() => useAckAlert(), { wrapper: buildApiWrapper().wrapper });

        let returned: unknown;
        await act(async () => {
            returned = await result.current.mutateAsync('a-1');
        });

        expect(returned).toBe('already-acked');
    });
});
