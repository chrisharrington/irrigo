import { renderHook, waitFor } from '@testing-library/react-native';

jest.mock('expo-notifications', () => ({
    getExpoPushTokenAsync: jest.fn(),
}));

jest.mock('expo-constants', () => ({
    __esModule: true,
    default: {
        expoConfig: { extra: { eas: { projectId: 'test-project-id' } } },
        easConfig: undefined,
    },
}));

import * as Notifications from 'expo-notifications';
import { usePushToken } from '.';

const getExpoPushTokenAsync = Notifications.getExpoPushTokenAsync as jest.Mock;

describe('usePushToken', () => {
    let warnSpy: ReturnType<typeof jest.spyOn>;

    beforeEach(() => {
        getExpoPushTokenAsync.mockReset();
        warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        warnSpy.mockRestore();
    });

    it('returns `null` and does not call the OS while permission is not yet granted.', () => {
        const { result } = renderHook(() => usePushToken({ permissionGranted: false }));

        expect(result.current.token).toBeNull();
        expect(result.current.isLoading).toBe(false);
        expect(getExpoPushTokenAsync).not.toHaveBeenCalled();
    });

    it('fetches the Expo push token once permission flips to granted.', async () => {
        getExpoPushTokenAsync.mockResolvedValueOnce({ data: 'ExponentPushToken[abc123]', type: 'expo' });

        const { result, rerender } = renderHook(
            ({ granted }: { granted: boolean }) => usePushToken({ permissionGranted: granted }),
            { initialProps: { granted: false } },
        );

        expect(result.current.token).toBeNull();

        rerender({ granted: true });

        await waitFor(() => expect(result.current.token).toBe('ExponentPushToken[abc123]'));
        expect(getExpoPushTokenAsync).toHaveBeenCalledTimes(1);
        // Project id from Constants flows through.
        expect(getExpoPushTokenAsync).toHaveBeenCalledWith({ projectId: 'test-project-id' });
    });

    it('falls back to `null` and logs a warning when the OS call throws.', async () => {
        getExpoPushTokenAsync.mockRejectedValueOnce(new Error('FCM unavailable'));

        const { result } = renderHook(() => usePushToken({ permissionGranted: true }));

        await waitFor(() => expect(result.current.isLoading).toBe(false));
        expect(result.current.token).toBeNull();
        expect(warnSpy).toHaveBeenCalled();
    });

    it('clears the token when permission flips back from granted to false.', async () => {
        getExpoPushTokenAsync.mockResolvedValueOnce({ data: 'ExponentPushToken[abc123]', type: 'expo' });

        const { result, rerender } = renderHook(
            ({ granted }: { granted: boolean }) => usePushToken({ permissionGranted: granted }),
            { initialProps: { granted: true } },
        );

        await waitFor(() => expect(result.current.token).toBe('ExponentPushToken[abc123]'));

        rerender({ granted: false });

        expect(result.current.token).toBeNull();
    });
});
