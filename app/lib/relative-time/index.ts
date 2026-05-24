import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;

/**
 * Formats `lastFiredAt` (an ISO-8601 UTC instant) as the human-readable
 * "Last ran ..." string used on each zone tile. Returns the empty string
 * when the input is `null` so callers can render their own fallback.
 *
 * Resolution:
 *   - within an hour      → `'just now'`
 *   - same calendar day   → `'<n>h ago'`
 *   - last calendar day   → `'last night'`
 *   - older               → `'<n> nights ago'`
 */
export function formatLastRan(iso: string | null, now: Date): string {
    if (iso === null) return '';
    const last = dayjs(iso);
    const present = dayjs(now);
    const diffMs = present.valueOf() - last.valueOf();
    if (diffMs < MS_PER_HOUR) return 'just now';
    if (diffMs < MS_PER_DAY) {
        const hours = Math.floor(diffMs / MS_PER_HOUR);
        return `${hours}h ago`;
    }
    const days = Math.floor(diffMs / MS_PER_DAY);
    if (days === 1) return 'last night';
    return `${days} nights ago`;
}

/**
 * Formats the time delta between `now` and `iso` as a compact countdown
 * (`'8h 14m'` or `'42m'`). Returns `'—'` for null inputs and `'now'` for
 * deltas under 60 seconds.
 */
export function formatCountdown(iso: string | null, now: Date): string {
    if (iso === null) return '—';
    const target = dayjs(iso);
    const present = dayjs(now);
    const diffMs = target.valueOf() - present.valueOf();
    if (diffMs < MS_PER_MINUTE) return 'now';
    const totalMinutes = Math.floor(diffMs / MS_PER_MINUTE);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours === 0) return `${minutes}m`;
    return `${hours}h ${minutes}m`;
}

/**
 * Formats `iso` as `'10:23 pm'` style in the supplied IANA timezone.
 */
export function formatTimeOfDay(iso: string, timezoneName: string): string {
    return dayjs(iso).tz(timezoneName).format('h:mm a');
}

/**
 * Formats `iso` for the hero's "ends ..." suffix (`'ends 5:48 am'`).
 * Identical formatter to `formatTimeOfDay`; named separately for grep-
 * ability at call sites.
 */
export function formatEndsAt(iso: string, timezoneName: string): string {
    return dayjs(iso).tz(timezoneName).format('h:mm a');
}
