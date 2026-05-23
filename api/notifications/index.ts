import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

/**
 * Notification framework. Surfaces day-level irrigation events and errors
 * through Home Assistant's `notify` service so HA can fan them out to whatever
 * channels it has wired up (mobile companion, persistent notification, email,
 * etc.).
 *
 * Best-effort by design: the notifier never throws, never retries, and never
 * blocks the caller's work for long. The alerting channel can be the failing
 * channel — retrying notifications during an HA outage just makes things
 * worse.
 */

/**
 * Coarse event categories. `schedule-*` covers daemon-driven scheduled runs;
 * `watering-*` is reserved for manual operator-initiated fires from the
 * `/zones/:id/...` HTTP surface; `error` covers any failure.
 */
export type NotificationEvent =
    | 'schedule-begun'
    | 'schedule-ended'
    | 'watering-started'
    | 'watering-ended'
    | 'error';

/**
 * Optional context fields included on a notification. Producers fill in
 * whichever fields are relevant; the message-builder formats them into
 * human-readable copy.
 */
export type NotificationContext = {
    /** Zone display name. Used in `watering-*` and `error` messages. */
    zoneName?: string;

    /** Cycle duration in minutes. Included on `watering-started` for manual fires. */
    durationMin?: number;

    /** Qualifier for watering-* events: `'manual'` flips the message to the manual-fire variant; `'shutdown'` flips watering-ended to the daemon-shutdown variant. Not consumed by the error path. */
    reason?: string;

    /** Required for the `'error'` event: the human-readable failure mode. Sentence-cased, no terminal period. Example: `'Weather API stale'`. */
    errorTitle?: string;

    /** Optional sub-line for the `'error'` event: the consequence or context. Should end in a period. Example: `'Planner using fallback ET zero. Last fetch error: 502 Bad Gateway.'`. */
    errorSub?: string;

    /**
     * The irrigation night the schedule event refers to, as a local-date string
     * (`YYYY-MM-DD` in the site's timezone). Included on `schedule-begun` and
     * `schedule-ended` so the body can name the night unambiguously.
     */
    scheduleNight?: string;

    /**
     * Total minutes watered per zone for the night. Keys are zone display names;
     * values are durations in minutes. Used to format the `schedule-ended`
     * summary line.
     */
    perZoneRuntimeMin?: Record<string, number>;

    /** Site timezone used to format `nextIrrigation` for the operator. */
    siteTimezone?: string;

    /** Next scheduled irrigation, included on the `schedule-ended` body when one is known. */
    nextIrrigation?: { zoneName: string; startTime: Date };
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
        scheduleStart: parseBoolean(process.env.NOTIFY_ON_SCHEDULE_START, true),
        scheduleEnd: parseBoolean(process.env.NOTIFY_ON_SCHEDULE_END, true),
        wateringStarted: parseBoolean(process.env.NOTIFY_ON_WATERING_START, false),
        wateringEnded: parseBoolean(process.env.NOTIFY_ON_WATERING_END, false),
        error: parseBoolean(process.env.NOTIFY_ON_ERROR, true),
    };

    const endpoint = `${url.endsWith('/') ? url.slice(0, -1) : url}/api/services/notify/${service}`;

    return async (event, context) => {
        if (event === 'schedule-begun' && !flags.scheduleStart) return;
        if (event === 'schedule-ended' && !flags.scheduleEnd) return;
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
    if (event === 'schedule-begun') {
        const night = context?.scheduleNight;
        return night
            ? `Irrigation schedule started for the night of ${night}.`
            : `Irrigation schedule started.`;
    }
    if (event === 'schedule-ended') {
        return buildScheduleEndedMessage(context);
    }
    if (event === 'watering-started') {
        const zone = context?.zoneName ?? 'Zone';
        const dur = context?.durationMin !== undefined ? ` (~${context.durationMin} min)` : '';
        if (context?.reason === 'manual') return `${zone} watering started${dur} (manual fire).`;
        return `${zone} watering started${dur}.`;
    }
    if (event === 'watering-ended') {
        const zone = context?.zoneName ?? 'Zone';
        if (context?.reason === 'shutdown') return `${zone} watering ended (closed during daemon shutdown).`;
        if (context?.reason === 'manual') return `${zone} watering ended (manual fire).`;
        return `${zone} watering ended.`;
    }
    // error
    const zone = context?.zoneName;
    const title = context?.errorTitle ?? 'Irrigo error';
    const sub = context?.errorSub;
    const head = zone ? `${zone}: ${title}.` : `${title}.`;
    return sub ? `${head} ${sub}` : head;
}

function buildScheduleEndedMessage(context?: NotificationContext): string {
    const summary = formatSummary(context?.perZoneRuntimeMin);
    const next = formatNextIrrigation(context?.nextIrrigation, context?.siteTimezone);

    const head = summary === null
        ? `Irrigation complete.`
        : `Irrigation complete: ${summary}.`;
    return next === null ? head : `${head} ${next}`;
}

function formatSummary(perZone: Record<string, number> | undefined): string | null {
    if (!perZone) return null;
    const entries = Object.entries(perZone);
    if (entries.length === 0) return null;
    // Sort alphabetically for stable output and human-scannable ordering.
    entries.sort(([a], [b]) => a.localeCompare(b));
    return entries.map(([zone, mins]) => `${zone} ${roundMin(mins)} min`).join(', ');
}

function formatNextIrrigation(
    next: { zoneName: string; startTime: Date } | undefined,
    siteTimezone: string | undefined,
): string | null {
    if (!next) return null;
    const formatted = siteTimezone
        ? dayjs(next.startTime).tz(siteTimezone).format('ddd D MMM [at] h:mma')
        : dayjs(next.startTime).format('ddd D MMM [at] h:mma');
    return `Next irrigation: ${next.zoneName} on ${formatted}.`;
}

function roundMin(value: number): number {
    return Math.round(value * 10) / 10;
}

function parseBoolean(raw: string | undefined, fallback: boolean): boolean {
    if (raw === undefined) return fallback;
    const lower = raw.trim().toLowerCase();
    if (lower === 'true' || lower === '1') return true;
    if (lower === 'false' || lower === '0' || lower === '') return false;
    return fallback;
}
