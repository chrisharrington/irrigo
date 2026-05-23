import { renderHook, waitFor } from '@testing-library/react-native';

jest.mock('expo-notifications', () => ({
    getLastNotificationResponseAsync: jest.fn(),
}));

import * as Notifications from 'expo-notifications';
import { useLaunchAlertId } from '.';

const getLastNotificationResponseAsync = Notifications.getLastNotificationResponseAsync as jest.Mock;

describe('useLaunchAlertId', () => {
    let warnSpy: ReturnType<typeof jest.spyOn>;

    beforeEach(() => {
        getLastNotificationResponseAsync.mockReset();
        warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        warnSpy.mockRestore();
    });

    it('returns `null` when the app was not launched from a tap.', async () => {
        getLastNotificationResponseAsync.mockResolvedValueOnce(null);

        const { result } = renderHook(() => useLaunchAlertId());

        await waitFor(() => expect(getLastNotificationResponseAsync).toHaveBeenCalled());
        expect(result.current).toBeNull();
    });

    it('returns the alertId from a tap-launched notification response.', async () => {
        getLastNotificationResponseAsync.mockResolvedValueOnce({
            notification: {
                request: {
                    content: {
                        data: { alertId: 'alert-007', zoneId: 'zone-001' },
                    },
                },
            },
        });

        const { result } = renderHook(() => useLaunchAlertId());

        await waitFor(() => expect(result.current).toBe('alert-007'));
    });

    it('returns `null` if the notification carries no alertId.', async () => {
        getLastNotificationResponseAsync.mockResolvedValueOnce({
            notification: {
                request: {
                    content: {
                        data: { zoneId: 'zone-001' },
                    },
                },
            },
        });

        const { result } = renderHook(() => useLaunchAlertId());

        await waitFor(() => expect(getLastNotificationResponseAsync).toHaveBeenCalled());
        expect(result.current).toBeNull();
    });

    it('logs a warning and returns `null` if the OS call throws.', async () => {
        getLastNotificationResponseAsync.mockRejectedValueOnce(new Error('OS boom'));

        const { result } = renderHook(() => useLaunchAlertId());

        await waitFor(() => expect(warnSpy).toHaveBeenCalled());
        expect(result.current).toBeNull();
    });
});
