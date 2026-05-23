import { act, renderHook, waitFor } from '@testing-library/react-native';
import { buildApiWrapper, jsonResponse } from '@/api/test-utils';
import { keys } from '@/api/query-keys';
import {
    useDisableSchedule,
    useEnableSchedule,
    useResumeScheduleTonight,
    useSchedules,
    useSkipScheduleTonight,
} from '.';

const mockFetch = jest.fn();

beforeEach(() => {
    (global as { fetch: typeof fetch }).fetch = mockFetch as unknown as typeof fetch;
    mockFetch.mockReset();
    process.env.EXPO_PUBLIC_API_BASE_URL = 'http://test.local:9753';
});

function scheduleResponse(status: string, skippedNightDate: string | null = null) {
    return jsonResponse({
        status,
        schedule: { slug: 'maintenance', name: 'Maintenance', siteId: 'site-A', skippedNightDate },
    });
}

function seedSchedulesCaches(client: ReturnType<typeof buildApiWrapper>['client']) {
    client.setQueryData(keys.schedules.list(), []);
    client.setQueryData(keys.tonight.summary(), { state: 'idle' });
    client.setQueryData(keys.zones.list(), []);
}

function expectScheduleInvalidations(client: ReturnType<typeof buildApiWrapper>['client']) {
    expect(client.getQueryState(keys.schedules.list())?.isInvalidated).toBe(true);
    expect(client.getQueryState(keys.tonight.summary())?.isInvalidated).toBe(true);
    expect(client.getQueryState(keys.zones.list())?.isInvalidated).toBe(true);
}

describe('useSchedules', () => {
    it('fetches /schedules and exposes the array.', async () => {
        mockFetch.mockResolvedValueOnce(jsonResponse([{ id: 's-1', slug: 'maintenance', name: 'Maintenance', isActive: true }]));

        const { result } = renderHook(() => useSchedules(), { wrapper: buildApiWrapper().wrapper });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.data?.[0]?.slug).toBe('maintenance');
    });
});

describe('useEnableSchedule', () => {
    it('POSTs to /schedule/enable/:slug and invalidates schedules, tonight, zones.', async () => {
        mockFetch.mockResolvedValueOnce(scheduleResponse('enabled'));

        const { wrapper, client } = buildApiWrapper();
        seedSchedulesCaches(client);
        const { result } = renderHook(() => useEnableSchedule(), { wrapper });

        await act(async () => {
            await result.current.mutateAsync('maintenance');
        });

        expect((mockFetch.mock.calls[0] as [string, RequestInit])[0]).toBe('http://test.local:9753/schedule/enable/maintenance');
        expectScheduleInvalidations(client);
    });
});

describe('useDisableSchedule', () => {
    it('POSTs to /schedule/disable/:slug and invalidates schedules, tonight, zones.', async () => {
        mockFetch.mockResolvedValueOnce(scheduleResponse('disabled'));

        const { wrapper, client } = buildApiWrapper();
        seedSchedulesCaches(client);
        const { result } = renderHook(() => useDisableSchedule(), { wrapper });

        await act(async () => {
            await result.current.mutateAsync('eco');
        });

        expect((mockFetch.mock.calls[0] as [string, RequestInit])[0]).toBe('http://test.local:9753/schedule/disable/eco');
        expectScheduleInvalidations(client);
    });
});

describe('useSkipScheduleTonight', () => {
    it('POSTs to /schedule/skip-tonight and invalidates schedules, tonight, zones.', async () => {
        mockFetch.mockResolvedValueOnce(scheduleResponse('skipped', '2026-05-22'));

        const { wrapper, client } = buildApiWrapper();
        seedSchedulesCaches(client);
        const { result } = renderHook(() => useSkipScheduleTonight(), { wrapper });

        await act(async () => {
            await result.current.mutateAsync();
        });

        expect((mockFetch.mock.calls[0] as [string, RequestInit])[0]).toBe('http://test.local:9753/schedule/skip-tonight');
        expectScheduleInvalidations(client);
    });
});

describe('useResumeScheduleTonight', () => {
    it('POSTs to /schedule/resume-tonight and invalidates schedules, tonight, zones.', async () => {
        mockFetch.mockResolvedValueOnce(scheduleResponse('resumed', null));

        const { wrapper, client } = buildApiWrapper();
        seedSchedulesCaches(client);
        const { result } = renderHook(() => useResumeScheduleTonight(), { wrapper });

        await act(async () => {
            await result.current.mutateAsync();
        });

        expect((mockFetch.mock.calls[0] as [string, RequestInit])[0]).toBe('http://test.local:9753/schedule/resume-tonight');
        expectScheduleInvalidations(client);
    });
});
