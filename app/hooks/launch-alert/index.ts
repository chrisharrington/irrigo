import { useEffect, useState } from 'react';
import * as Notifications from 'expo-notifications';

/**
 * Returns the `alertId` carried by the notification that launched the app
 * from a cold-start tap, or `null` if the launch wasn't notification-
 * driven. The eventual Activity screen consumes this to scroll the
 * matching alert into view.
 *
 * Reads once per mount via `getLastNotificationResponseAsync` — Expo's
 * runtime caches the response for the session, so re-mounting the
 * Activity screen returns the same id until the operator dismisses it.
 */
export function useLaunchAlertId(): string | null {
    const [alertId, setAlertId] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const response = await Notifications.getLastNotificationResponseAsync();
                if (cancelled) return;
                const data = response?.notification.request.content.data ?? null;
                if (data === null) return;
                const candidate = data.alertId;
                if (typeof candidate === 'string') setAlertId(candidate);
            } catch (err) {
                console.warn('launch-alert: getLastNotificationResponseAsync failed.', err);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    return alertId;
}
