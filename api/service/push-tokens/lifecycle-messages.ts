import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

import type { PushMessageContent } from '.';

dayjs.extend(utc);
dayjs.extend(timezone);

/**
 * Pure builders that turn a lifecycle event into the `title` / `body` / `data`
 * of an Expo push. Copy is ported from the HA notifier's `buildMessage`
 * (`api/notifications/index.ts`, removed in API-50) so message quality is
 * preserved as notifications move to Expo. `data.category` lets the client
 * route the push (APP-103); watering events also carry `zoneId`.
 */

/** Schedule run started — the night's first cycle opened. */
export function scheduleStartedMessage(scheduleNight?: string): PushMessageContent {
    return {
        title: 'Irrigation started',
        body: scheduleNight
            ? `Schedule started for the night of ${scheduleNight}.`
            : 'Schedule started.',
        data: { category: 'scheduleStart' },
    };
}

/** Schedule run finished — the night's last cycle closed. */
export function scheduleEndedMessage(input: {
    perZoneRuntimeMin: Record<string, number>;
    siteTimezone: string;
    nextIrrigation?: { zoneName: string; startTime: Date };
}): PushMessageContent {
    const summary = formatSummary(input.perZoneRuntimeMin);
    const next = formatNextIrrigation(input.nextIrrigation, input.siteTimezone);
    const head = summary === null ? 'All cycles complete.' : `Watered ${summary}.`;
    return {
        title: 'Irrigation complete',
        body: next === null ? head : `${head} ${next}`,
        data: { category: 'scheduleEnd' },
    };
}

/** A zone started watering (manual fire, or a manual `run` with a duration). */
export function wateringStartedMessage(input: {
    zoneName: string;
    zoneId: string;
    durationMin?: number;
    reason?: string;
}): PushMessageContent {
    const dur = input.durationMin !== undefined ? ` (~${input.durationMin} min)` : '';
    const tail = input.reason === 'manual' ? ' (manual fire).' : '.';
    return {
        title: 'Watering started',
        body: `${input.zoneName} watering started${dur}${tail}`,
        data: { category: 'wateringStart', zoneId: input.zoneId },
    };
}

/** A zone stopped watering. `reason` flips the copy for manual / shutdown closes. */
export function wateringEndedMessage(input: {
    zoneName: string;
    zoneId: string;
    reason?: string;
}): PushMessageContent {
    const tail = input.reason === 'shutdown'
        ? ' (closed during daemon shutdown).'
        : input.reason === 'manual'
            ? ' (manual fire).'
            : '.';
    return {
        title: 'Watering ended',
        body: `${input.zoneName} watering ended${tail}`,
        data: { category: 'wateringEnd', zoneId: input.zoneId },
    };
}

/**
 * Renders per-zone runtimes into `North 12 min, South 8.5 min`, sorted by zone
 * name for stable output. Returns null when there's nothing watered.
 */
function formatSummary(perZone: Record<string, number>): string | null {
    const entries = Object.entries(perZone);
    if (entries.length === 0) return null;
    entries.sort(([a], [b]) => a.localeCompare(b));
    return entries.map(([zone, mins]) => `${zone} ${roundMin(mins)} min`).join(', ');
}

/**
 * Renders the next scheduled irrigation into a `Next irrigation: <zone> on
 * <date>.` sentence, formatted in the site's timezone. Returns null when none
 * is known.
 */
function formatNextIrrigation(
    next: { zoneName: string; startTime: Date } | undefined,
    siteTimezone: string,
): string | null {
    if (!next) return null;
    const formatted = dayjs(next.startTime).tz(siteTimezone).format('ddd D MMM [at] h:mma');
    return `Next irrigation: ${next.zoneName} on ${formatted}.`;
}

function roundMin(value: number): number {
    return Math.round(value * 10) / 10;
}
