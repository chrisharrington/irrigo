import { useCallback, useEffect, useState } from 'react';
import * as Notifications from 'expo-notifications';

/**
 * Coarse permission state used by the notifications bridge to decide
 * whether to fetch an Expo push token. `'pending'` covers both the
 * initial "haven't queried yet" state and the in-flight prompt.
 */
export type PushPermissionStatus = 'pending' | 'granted' | 'denied';

/**
 * Shape returned by `usePushPermission`. `status` is observed by callers;
 * `request` is a no-arg trigger that re-prompts the OS (e.g. when the
 * operator returns from settings and the permission may have changed).
 */
export type UsePushPermissionResult = {
    status: PushPermissionStatus;
    request: () => Promise<void>;
};

/**
 * Narrow view of the response from `getPermissionsAsync` /
 * `requestPermissionsAsync`. The real return type extends
 * `PermissionResponse` from a package that's missing in the published
 * type definitions, so TypeScript can't see the inherited fields — this
 * adapter restores the surface we actually use.
 */
type PermissionSnapshot = {
    granted: boolean;
    canAskAgain: boolean;
    status: string;
};

/**
 * On mount, reads the current notification permission. If
 * `'undetermined'` (the iOS pre-prompt state), automatically calls
 * `requestPermissionsAsync` once. After that, the hook is passive — call
 * `request()` to re-prompt manually. Failures are logged at `warn` and
 * mapped to `'denied'` so the caller has a deterministic state to react
 * to (no `'pending'` zombie).
 */
export function usePushPermission(): UsePushPermissionResult {
    const [status, setStatus] = useState<PushPermissionStatus>('pending');

    useEffect(() => {
        let cancelled = false;
        const resolveInitial = async (): Promise<void> => {
            try {
                const settings = (await Notifications.getPermissionsAsync()) as unknown as PermissionSnapshot;
                if (cancelled) return;

                if (settings.granted) {
                    setStatus('granted');
                    return;
                }

                if (settings.canAskAgain === false || settings.status === Notifications.PermissionStatus.DENIED) {
                    setStatus('denied');
                    return;
                }

                const requested = (await Notifications.requestPermissionsAsync()) as unknown as PermissionSnapshot;
                if (cancelled) return;
                setStatus(requested.granted ? 'granted' : 'denied');
            } catch (err) {
                console.warn('push-permission: initial check failed; treating as denied.', err);
                if (!cancelled) setStatus('denied');
            }
        };

        void resolveInitial();
        return () => {
            cancelled = true;
        };
    }, []);

    const request = useCallback(async (): Promise<void> => {
        try {
            const requested = (await Notifications.requestPermissionsAsync()) as unknown as PermissionSnapshot;
            setStatus(requested.granted ? 'granted' : 'denied');
        } catch (err) {
            console.warn('push-permission: request failed.', err);
            setStatus('denied');
        }
    }, []);

    return { status, request };
}
