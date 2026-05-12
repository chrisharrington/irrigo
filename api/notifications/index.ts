/**
 * Notification framework. Surfaces watering events and errors through Home
 * Assistant's `notify` service so HA can fan them out to whatever channels
 * it has wired up (mobile companion, persistent notification, email, etc.).
 *
 * Best-effort by design: the notifier never throws, never retries, and never
 * blocks the caller's work for long. The alerting channel can be the failing
 * channel — retrying notifications during an HA outage just makes things
 * worse.
 */

/** Coarse event categories the daemon emits. */
export type NotificationEvent = 'watering-started' | 'watering-ended' | 'error';

/**
 * Optional context fields included on a notification. Producers fill in
 * whichever fields are relevant; the message-builder formats them into
 * human-readable copy.
 */
export type NotificationContext = {
    /** Zone display name. Used in the notification message. */
    zoneName?: string;

    /** Cycle duration in minutes. Included in `watering-started` messages. */
    durationMin?: number;

    /** Operation that failed for `error` events (e.g. `open`, `close`, `re-plan`). */
    operation?: string;

    /** Free-form qualifier (`boot`, `shutdown`, error message, etc.). */
    reason?: string;
};

/**
 * Sends a notification. Resolves whether or not the notification succeeded —
 * callers should fire-and-forget.
 */
export type Notifier = (event: NotificationEvent, context?: NotificationContext) => Promise<void>;

/**
 * No-op default: resolves immediately, never touches the network. Returned
 * by `createNotifier` when the env config disables notifications, and used
 * as the safe daemon default for tests.
 */
export const noopNotifier: Notifier = async () => {};

/**
 * Reads notification config from env at construction time and returns a
 * `Notifier` closure. If `HA_URL`, `HA_TOKEN`, or `HA_NOTIFY_SERVICE` is
 * missing, returns `noopNotifier` and logs a single `console.warn` so the
 * operator knows notifications are off.
 */
export function createNotifier(): Notifier {
    const url = process.env.HA_URL;
    const token = process.env.HA_TOKEN;
    const service = process.env.HA_NOTIFY_SERVICE;

    if (!url || !token || !service) {
        console.warn('notifications: HA_URL, HA_TOKEN, or HA_NOTIFY_SERVICE not set; notifications disabled.');
        return noopNotifier;
    }

    const flags = {
        wateringStarted: parseBoolean(process.env.NOTIFY_ON_WATERING_START, false),
        wateringEnded: parseBoolean(process.env.NOTIFY_ON_WATERING_END, false),
        error: parseBoolean(process.env.NOTIFY_ON_ERROR, true),
    };

    const endpoint = `${url.endsWith('/') ? url.slice(0, -1) : url}/api/services/notify/${service}`;

    return async (event, context) => {
        if (event === 'watering-started' && !flags.wateringStarted) return;
        if (event === 'watering-ended' && !flags.wateringEnded) return;
        if (event === 'error' && !flags.error) return;

        const message = buildMessage(event, context);
        const body = JSON.stringify({ message, title: 'Irrigo' });

        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body,
            });
            if (!response.ok) {
                console.warn(`notifications: HA notify ${event} returned ${response.status} ${response.statusText}.`);
            }
        } catch (err) {
            console.warn(`notifications: HA notify ${event} failed; swallowing.`, err);
        }
    };
}

export function buildMessage(event: NotificationEvent, context?: NotificationContext): string {
    const zone = context?.zoneName ?? 'Zone';
    if (event === 'watering-started') {
        const dur = context?.durationMin !== undefined ? ` (~${context.durationMin} min)` : '';
        if (context?.reason === 'boot') return `${zone} watering started${dur} (recovered after daemon restart).`;
        return `${zone} watering started${dur}.`;
    }
    if (event === 'watering-ended') {
        if (context?.reason === 'shutdown') return `${zone} watering ended (closed during daemon shutdown).`;
        return `${zone} watering ended.`;
    }
    // error
    const op = context?.operation ?? 'unknown';
    const reason = context?.reason ?? 'unknown';
    return `Irrigo error during ${op} on ${zone}: ${reason}.`;
}

function parseBoolean(raw: string | undefined, fallback: boolean): boolean {
    if (raw === undefined) return fallback;
    const lower = raw.trim().toLowerCase();
    if (lower === 'true' || lower === '1') return true;
    if (lower === 'false' || lower === '0' || lower === '') return false;
    return fallback;
}
