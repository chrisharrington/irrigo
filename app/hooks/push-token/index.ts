import { useEffect, useState } from 'react';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';

/**
 * Shape returned by `usePushToken`. `token` is `null` while we don't yet
 * have permission or before the device call completes; non-null once the
 * Expo push service returns a token.
 */
export type UsePushTokenResult = {
    token: string | null;
    isLoading: boolean;
};

export type UsePushTokenParams = {
    /** Required. Drives the fetch — `false` keeps the token at `null` without calling the OS. */
    permissionGranted: boolean;
};

/**
 * Fetches the device's Expo push token whenever permission flips to
 * granted. Returns `null` until permission is granted; logs and surfaces
 * `null` on failure. The token may change across launches (Expo may
 * rotate it) — callers should re-POST to the api every time we hand them
 * a fresh value.
 */
export function usePushToken({ permissionGranted }: UsePushTokenParams): UsePushTokenResult {
    const [token, setToken] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState<boolean>(false);

    useEffect(() => {
        if (!permissionGranted) {
            setToken(null);
            setIsLoading(false);
            return;
        }

        let cancelled = false;
        setIsLoading(true);

        const fetchToken = async (): Promise<void> => {
            try {
                const projectId = resolveProjectId();
                const result = await Notifications.getExpoPushTokenAsync(
                    projectId !== undefined ? { projectId } : undefined,
                );
                if (cancelled) return;
                setToken(result.data);
            } catch (err) {
                console.warn('push-token: fetch failed.', err);
                if (!cancelled) setToken(null);
            } finally {
                if (!cancelled) setIsLoading(false);
            }
        };

        void fetchToken();
        return () => {
            cancelled = true;
        };
    }, [permissionGranted]);

    return { token, isLoading };
}

/**
 * Pulls the EAS project id from the Expo config. Expo SDK 54 stores it on
 * `expoConfig.extra.eas.projectId`; older configs used `easConfig.projectId`.
 * `getExpoPushTokenAsync` requires it in standalone builds but works
 * without it in Expo Go — returning `undefined` lets the call fall back.
 */
function resolveProjectId(): string | undefined {
    const fromExtra = Constants.expoConfig?.extra?.eas?.projectId;
    if (typeof fromExtra === 'string') return fromExtra;
    const fromEasConfig = Constants.easConfig?.projectId;
    if (typeof fromEasConfig === 'string') return fromEasConfig;
    return undefined;
}
