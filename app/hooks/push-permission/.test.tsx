import { renderHook, waitFor } from '@testing-library/react-native';

jest.mock('expo-notifications', () => ({
    getPermissionsAsync: jest.fn(),
    requestPermissionsAsync: jest.fn(),
    PermissionStatus: {
        UNDETERMINED: 'undetermined',
        GRANTED: 'granted',
        DENIED: 'denied',
    },
}));

import * as Notifications from 'expo-notifications';
import { usePushPermission } from '.';

const getPermissionsAsync = Notifications.getPermissionsAsync as jest.Mock;
const requestPermissionsAsync = Notifications.requestPermissionsAsync as jest.Mock;

function buildStatus(overrides: { status?: string; granted?: boolean; canAskAgain?: boolean }) {
    return {
        status: overrides.status ?? 'undetermined',
        granted: overrides.granted ?? false,
        canAskAgain: overrides.canAskAgain ?? true,
        expires: 'never',
    };
}

describe('usePushPermission', () => {
    let warnSpy: ReturnType<typeof jest.spyOn>;

    beforeEach(() => {
        getPermissionsAsync.mockReset();
        requestPermissionsAsync.mockReset();
        warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        warnSpy.mockRestore();
    });

    it('reads an already-granted permission without prompting again.', async () => {
        getPermissionsAsync.mockResolvedValueOnce(buildStatus({ status: 'granted', granted: true }));

        const { result } = renderHook(() => usePushPermission());

        await waitFor(() => expect(result.current.status).toBe('granted'));
        expect(requestPermissionsAsync).not.toHaveBeenCalled();
    });

    it('treats an already-denied permission as denied without re-prompting.', async () => {
        getPermissionsAsync.mockResolvedValueOnce(buildStatus({ status: 'denied', canAskAgain: false }));

        const { result } = renderHook(() => usePushPermission());

        await waitFor(() => expect(result.current.status).toBe('denied'));
        expect(requestPermissionsAsync).not.toHaveBeenCalled();
    });

    it('prompts when the initial status is undetermined and reflects the granted result.', async () => {
        getPermissionsAsync.mockResolvedValueOnce(buildStatus({ status: 'undetermined', canAskAgain: true }));
        requestPermissionsAsync.mockResolvedValueOnce(buildStatus({ status: 'granted', granted: true }));

        const { result } = renderHook(() => usePushPermission());

        await waitFor(() => expect(result.current.status).toBe('granted'));
        expect(requestPermissionsAsync).toHaveBeenCalledTimes(1);
    });

    it('prompts when the initial status is undetermined and reflects a denied result.', async () => {
        getPermissionsAsync.mockResolvedValueOnce(buildStatus({ status: 'undetermined', canAskAgain: true }));
        requestPermissionsAsync.mockResolvedValueOnce(buildStatus({ status: 'denied', canAskAgain: false }));

        const { result } = renderHook(() => usePushPermission());

        await waitFor(() => expect(result.current.status).toBe('denied'));
        expect(requestPermissionsAsync).toHaveBeenCalledTimes(1);
    });

    it('exposes a `request` callback that re-prompts the OS.', async () => {
        getPermissionsAsync.mockResolvedValueOnce(buildStatus({ status: 'denied', canAskAgain: false }));
        requestPermissionsAsync.mockResolvedValueOnce(buildStatus({ status: 'granted', granted: true }));

        const { result } = renderHook(() => usePushPermission());

        await waitFor(() => expect(result.current.status).toBe('denied'));

        await result.current.request();

        await waitFor(() => expect(result.current.status).toBe('granted'));
        expect(requestPermissionsAsync).toHaveBeenCalledTimes(1);
    });

    it('falls back to `denied` and logs a warning when the OS call throws.', async () => {
        getPermissionsAsync.mockRejectedValueOnce(new Error('OS boom'));

        const { result } = renderHook(() => usePushPermission());

        await waitFor(() => expect(result.current.status).toBe('denied'));
        expect(warnSpy).toHaveBeenCalled();
    });
});
