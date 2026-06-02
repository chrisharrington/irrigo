import { act, renderHook, waitFor } from '@testing-library/react-native';
import { buildApiWrapper, jsonResponse } from '@/api/test-utils';
import { keys } from '@/api/query-keys';
import type { NotificationSettingsDto } from '@/api/types/settings';
import { useNotificationSettings, useUpdateNotificationSettings } from '.';

const mockFetch = jest.fn();

const DTO: NotificationSettingsDto = {
    scheduleStart: true,
    scheduleEnd: true,
    wateringStart: false,
    wateringEnd: false,
    error: true,
};

beforeEach(() => {
    (global as { fetch: typeof fetch }).fetch = mockFetch as unknown as typeof fetch;
    mockFetch.mockReset();
    process.env.EXPO_PUBLIC_API_BASE_URL = 'http://test.local:9753';
});

describe('useNotificationSettings', () => {
    it('fetches and exposes the notification settings.', async () => {
        mockFetch.mockResolvedValueOnce(jsonResponse(DTO));

        const { result } = renderHook(() => useNotificationSettings(), { wrapper: buildApiWrapper().wrapper });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.data).toEqual(DTO);
    });
});

describe('useUpdateNotificationSettings', () => {
    it('PATCHes /settings/notifications with the partial body.', async () => {
        mockFetch.mockResolvedValueOnce(jsonResponse({ ...DTO, wateringStart: true }));

        const { result } = renderHook(() => useUpdateNotificationSettings(), { wrapper: buildApiWrapper().wrapper });

        await act(async () => {
            await result.current.mutateAsync({ wateringStart: true });
        });

        const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
        expect(url).toBe('http://test.local:9753/settings/notifications');
        expect(init.method).toBe('PATCH');
        expect(JSON.parse(String(init.body))).toEqual({ wateringStart: true });
    });

    it('writes the optimistic flag into the cache synchronously on mutate.', async () => {
        // Fetch never resolves so the mutation stays in-flight; the optimistic
        // cache write should be observable immediately.
        mockFetch.mockImplementation(() => new Promise(() => {}));

        const { wrapper, client } = buildApiWrapper();
        client.setQueryData(keys.settings.notifications(), DTO);

        const { result } = renderHook(() => useUpdateNotificationSettings(), { wrapper });

        act(() => {
            result.current.mutate({ wateringStart: true });
        });

        await waitFor(() => {
            const cached = client.getQueryData<NotificationSettingsDto>(keys.settings.notifications());
            expect(cached?.wateringStart).toBe(true);
            // Other flags untouched by the partial merge.
            expect(cached?.scheduleStart).toBe(true);
        });
    });

    it('rolls the cache back to the previous value when the mutation rejects.', async () => {
        mockFetch.mockResolvedValueOnce(jsonResponse({ error: 'boom' }, 500));

        const { wrapper, client } = buildApiWrapper();
        client.setQueryData(keys.settings.notifications(), DTO);

        const { result } = renderHook(() => useUpdateNotificationSettings(), { wrapper });

        await act(async () => {
            await result.current.mutateAsync({ wateringStart: true }).catch(() => undefined);
        });

        expect(result.current.isError).toBe(true);
        expect(client.getQueryData(keys.settings.notifications())).toEqual(DTO);
    });

    it('invalidates the notification-settings query after a successful PATCH.', async () => {
        mockFetch.mockResolvedValueOnce(jsonResponse({ ...DTO, error: false }));

        const { wrapper, client } = buildApiWrapper();
        client.setQueryData(keys.settings.notifications(), DTO);

        const { result } = renderHook(() => useUpdateNotificationSettings(), { wrapper });

        await act(async () => {
            await result.current.mutateAsync({ error: false });
        });

        expect(client.getQueryState(keys.settings.notifications())?.isInvalidated).toBe(true);
    });
});
