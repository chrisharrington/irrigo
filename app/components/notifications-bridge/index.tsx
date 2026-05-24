import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { useRouter } from 'expo-router';

import { PushBanner } from '@/components/push-banner';
import type { AlertRowTone } from '@/components/alert-row';
import { usePushPermission } from '@/hooks/push-permission';
import { useRegisterPushToken } from '@/hooks/push-registration';
import { usePushToken } from '@/hooks/push-token';
import type { PushPlatform } from '@/api/types/push-registration';

/**
 * Configure the foreground notification behaviour at module scope so it
 * runs before any tree renders. We render our own in-app banner via
 * `<PushBanner>`, so the OS-level alert is suppressed (`shouldShowAlert:
 * false`) and the badge / sound paths are left alone for callers to opt
 * in to later.
 */
Notifications.setNotificationHandler({
    handleNotification: async () => ({
        shouldShowAlert: false,
        shouldPlaySound: false,
        shouldSetBadge: false,
        shouldShowBanner: false,
        shouldShowList: false,
    }),
});

type BannerState = {
    tone: AlertRowTone;
    title: string;
    sub?: string;
    zoneId?: string;
};

/**
 * Top-level component that bridges Expo push registration and incoming
 * notifications into the app. Mount once near the root of the tree. Owns:
 * the permission prompt, the push-token fetch, the api-side
 * `/push/register` call, the foreground banner state, and the response
 * listener that deep-links a tapped push to the related zone.
 *
 * Rendering: nothing visible until a notification arrives. The banner
 * positions itself relative to the safe-area top inset and dismisses
 * after 6 seconds (or on tap).
 */
export function NotificationsBridge() {
    const permission = usePushPermission();
    const permissionGranted = permission.status === 'granted';
    const { token } = usePushToken({ permissionGranted });
    const registerPushToken = useRegisterPushToken();
    const router = useRouter();
    const [banner, setBanner] = useState<BannerState | null>(null);
    const lastRegisteredTokenRef = useRef<string | null>(null);

    // Register the token with the api whenever it changes. The api treats
    // (token, platform) as idempotent; we still gate on the previous value
    // so a re-render with the same token doesn't fire a second POST.
    useEffect(() => {
        if (token === null) return;
        if (lastRegisteredTokenRef.current === token) return;
        lastRegisteredTokenRef.current = token;
        registerPushToken.mutate({
            token,
            platform: Platform.OS as PushPlatform,
            userAgent: buildUserAgent(),
        });
    }, [token, registerPushToken]);

    // Foreground notification → banner.
    useEffect(() => {
        const subscription = Notifications.addNotificationReceivedListener(notification => {
            const content = notification.request.content;
            const data = content.data ?? {};
            setBanner({
                tone: toneFromData(data),
                title: content.title ?? 'Irrigo alert',
                ...(content.body ? { sub: content.body } : {}),
                ...(typeof data.zoneId === 'string' ? { zoneId: data.zoneId } : {}),
            });
        });
        return () => {
            subscription.remove();
        };
    }, []);

    // Background tap → deep-link to the zone if the push carried a zoneId.
    useEffect(() => {
        const subscription = Notifications.addNotificationResponseReceivedListener(response => {
            const data = response.notification.request.content.data ?? {};
            if (typeof data.zoneId === 'string') {
                router.push(`/zone/${data.zoneId}` as never);
            }
        });
        return () => {
            subscription.remove();
        };
    }, [router]);

    const handleBannerPress = useCallback(() => {
        if (banner?.zoneId !== undefined) {
            router.push(`/zone/${banner.zoneId}` as never);
        }
        setBanner(null);
    }, [banner, router]);

    const handleBannerDismiss = useCallback(() => {
        setBanner(null);
    }, []);

    return (
        <PushBanner
            visible={banner !== null}
            tone={banner?.tone ?? 'info'}
            title={banner?.title ?? ''}
            {...(banner?.sub !== undefined ? { sub: banner.sub } : {})}
            onPress={handleBannerPress}
            onDismiss={handleBannerDismiss}
        />
    );
}

/**
 * Maps the optional `data.tone` payload into the AlertRow tone. Falls
 * back to `danger` since the most common server-side push class is a
 * failure event.
 */
function toneFromData(data: Record<string, unknown>): AlertRowTone {
    const tone = data.tone;
    if (tone === 'info' || tone === 'warn' || tone === 'danger') return tone;
    return 'danger';
}

/**
 * Builds the user-agent string sent alongside the push token. The api
 * stores it for support diagnostics; format is intentionally informal.
 */
function buildUserAgent(): string {
    const model = Device.modelName ?? 'unknown-device';
    const os = Device.osName ?? Platform.OS;
    const osVersion = Device.osVersion ?? String(Platform.Version);
    return `${model} / ${os} ${osVersion}`;
}
