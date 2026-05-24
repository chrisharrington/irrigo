import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

import { MS_PER_DAY, MS_PER_HOUR, MS_PER_MINUTE } from '@/constants/duration';

dayjs.extend(utc);
dayjs.extend(timezone);

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

/**
 * Formats a single per-zone cycle window for the next-run hero's schedule
 * list — `'h:mm am to h:mm am'`, lowercase, no leading zero on the hour.
 * The input is already site-local `HH:MM` and a duration in minutes, so
 * there's no timezone conversion: minutes-of-day arithmetic with a
 * modular wrap at midnight (a cycle starting at `23:50` for 30 min ends
 * at `00:20` the next morning, which renders as `'12:20 am'`).
 */
export function formatCycleWindow(startHhMm: string, durMin: number): string {
    const [hourStr, minuteStr] = startHhMm.split(':');
    const startMinuteOfDay = Number(hourStr) * 60 + Number(minuteStr);
    const endMinuteOfDay = (startMinuteOfDay + durMin) % (24 * 60);
    return `${formatLocalClock(startMinuteOfDay)} to ${formatLocalClock(endMinuteOfDay)}`;
}

function formatLocalClock(minuteOfDay: number): string {
    const hour24 = Math.floor(minuteOfDay / 60) % 24;
    const minute = minuteOfDay % 60;
    const period = hour24 < 12 ? 'am' : 'pm';
    const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
    return `${hour12}:${minute.toString().padStart(2, '0')} ${period}`;
}

/**
 * Formats the calendar-day offset between `now` and `iso` into the date
 * prefix used by the Home next-run subtitle. Comparisons are anchored in
 * the supplied IANA timezone so a UTC-late instant that still lands on
 * "today" locally doesn't slip into the "Tomorrow" bucket.
 *
 * Buckets:
 *
 * | Offset (calendar days, site-local) | Output         |
 * |------------------------------------|----------------|
 * | `<= 0` (today or already past)     | `''`           |
 * | `1`                                | `'Tomorrow'`   |
 * | `2`–`6`                            | `'Wed'`        |
 * | `>= 7`                             | `'Mon 28 May'` |
 */
export function formatNextRunDate(iso: string, timezoneName: string, now: Date): string {
    const target = dayjs(iso).tz(timezoneName).startOf('day');
    const present = dayjs(now).tz(timezoneName).startOf('day');
    const diffDays = target.diff(present, 'day');
    if (diffDays <= 0) return '';
    if (diffDays === 1) return 'Tomorrow';
    if (diffDays < 7) return dayjs(iso).tz(timezoneName).format('ddd');
    return dayjs(iso).tz(timezoneName).format('ddd D MMM');
}

/**
 * Formats an ISO-8601 timestamp into the short, suffix-free relative-age
 * label used in tight slots like `AlertRow`'s right-hand `when` column.
 * Buckets:
 *
 * | Age                  | Output |
 * |----------------------|--------|
 * | < 60 s (or future)   | `now`  |
 * | < 60 min             | `Nm`   |
 * | < 24 h               | `Nh`   |
 * | ≥ 24 h               | `Nd`   |
 *
 * Distinct from `formatLastRan` (which suffixes with `ago` / `night[s] ago`
 * for the zone tile's "Last ran" line) and from `formatCountdown` (which
 * targets a future instant). `reference` is the "now" anchor — production
 * callers omit it; tests inject a fixed `Date` so assertions are
 * deterministic.
 */
export function formatRelativeTime(iso: string, reference: Date = new Date()): string {
    const ageMs = reference.getTime() - new Date(iso).getTime();
    if (ageMs < MS_PER_MINUTE) return 'now';

    const ageMinutes = Math.floor(ageMs / MS_PER_MINUTE);
    if (ageMinutes < 60) return `${ageMinutes}m`;

    const ageHours = Math.floor(ageMs / MS_PER_HOUR);
    if (ageHours < 24) return `${ageHours}h`;

    const ageDays = Math.floor(ageMs / MS_PER_DAY);
    return `${ageDays}d`;
}
