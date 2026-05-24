import { act, renderHook } from '@testing-library/react-native';
import { buildApiWrapper, jsonResponse } from '@/api/test-utils';
import { keys } from '@/api/query-keys';
import { useCloseZone, useOpenZone, useRunZone } from '.';

const mockFetch = jest.fn();

beforeEach(() => {
    (global as { fetch: typeof fetch }).fetch = mockFetch as unknown as typeof fetch;
    mockFetch.mockReset();
    process.env.EXPO_PUBLIC_API_BASE_URL = 'http://test.local:9753';
});

function seedZoneCaches(client: ReturnType<typeof buildApiWrapper>['client']) {
    client.setQueryData(keys.zones.list(), []);
    client.setQueryData(keys.nextRun.summary(), { state: 'idle' });
}

function expectZoneInvalidations(client: ReturnType<typeof buildApiWrapper>['client']) {
    expect(client.getQueryState(keys.zones.list())?.isInvalidated).toBe(true);
    expect(client.getQueryState(keys.nextRun.summary())?.isInvalidated).toBe(true);
}

describe('useOpenZone', () => {
    it('POSTs /zones/:id/open and invalidates zones + next-run.', async () => {
        mockFetch.mockResolvedValueOnce(jsonResponse({ status: 'open', since: '2026-05-22T00:00:00.000Z' }));

        const { wrapper, client } = buildApiWrapper();
        seedZoneCaches(client);
        const { result } = renderHook(() => useOpenZone(), { wrapper });

        await act(async () => {
            await result.current.mutateAsync('z-1');
        });

        expect((mockFetch.mock.calls[0] as [string, RequestInit])[0]).toBe('http://test.local:9753/zones/z-1/open');
        expectZoneInvalidations(client);
    });
});

describe('useCloseZone', () => {
    it('POSTs /zones/:id/close and invalidates zones + next-run.', async () => {
        mockFetch.mockResolvedValueOnce(jsonResponse({ status: 'closed' }));

        const { wrapper, client } = buildApiWrapper();
        seedZoneCaches(client);
        const { result } = renderHook(() => useCloseZone(), { wrapper });

        await act(async () => {
            await result.current.mutateAsync('z-1');
        });

        expect((mockFetch.mock.calls[0] as [string, RequestInit])[0]).toBe('http://test.local:9753/zones/z-1/close');
        expectZoneInvalidations(client);
    });
});

describe('useRunZone', () => {
    it('POSTs /zones/:id/run with the durationMin body and invalidates zones + next-run.', async () => {
        mockFetch.mockResolvedValueOnce(jsonResponse({ status: 'open', since: '2026-05-22T00:00:00.000Z', willCloseAt: '2026-05-22T00:15:00.000Z' }));

        const { wrapper, client } = buildApiWrapper();
        seedZoneCaches(client);
        const { result } = renderHook(() => useRunZone(), { wrapper });

        await act(async () => {
            await result.current.mutateAsync({ zoneId: 'z-1', durationMin: 15 });
        });

        const [calledUrl, init] = mockFetch.mock.calls[0] as [string, RequestInit];
        expect(calledUrl).toBe('http://test.local:9753/zones/z-1/run');
        expect(JSON.parse(init.body as string)).toEqual({ durationMin: 15 });
        expectZoneInvalidations(client);
    });
});
