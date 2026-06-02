import dayjs from 'dayjs';

import { MS_PER_DAY, MS_PER_HOUR, MS_PER_MINUTE } from '@/constants/duration';

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
 *
 * Day buckets are counted in device-local *calendar* days, not raw 24 h spans,
 * so a run 24–48 h back that crossed two midnights reads `'2 nights ago'`
 * rather than `'last night'`. APP-87.
 */
export function formatLastRan(iso: string | null, now: Date): string {
    if (iso === null) return '';
    const last = dayjs(iso);
    const present = dayjs(now);
    // Clamp future-dated input to 0 so clock skew (or upstream data bugs)
    // can't render a negative bucket like `'-2 nights ago'`. APP-55.
    const diffMs = Math.max(0, present.valueOf() - last.valueOf());
    if (diffMs < MS_PER_HOUR) return 'just now';

    // Calendar-day offset (device-local): the number of midnights between the
    // run and now. `Math.max(0, …)` guards future-dated runs that slipped past
    // the sub-hour clamp above.
    const dayDiff = Math.max(0, present.startOf('day').diff(last.startOf('day'), 'day'));
    if (dayDiff === 0) {
        const hours = Math.floor(diffMs / MS_PER_HOUR);
        return `${hours}h ago`;
    }
    if (dayDiff === 1) return 'last night';
    return `${dayDiff} nights ago`;
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
 * Formats `iso` as `'22:23'` (24-hour) style in the device-local timezone.
 * Named-zone conversion was dropped on the client (APP-88) — dayjs's `.tz()`
 * renders UTC on Hermes-on-Android — so the operator sees their own device clock.
 */
export function formatTimeOfDay(iso: string): string {
    return dayjs(iso).format('HH:mm');
}

/**
 * Formats an activity-row label using the real start instant when available
 * and falling back to the entry's calendar day when not.
 *
 * When `startedAt` is non-null, both the day and the time-of-day come from
 * the real instant (`'May 13 · 09:00'`) in the device-local timezone —
 * the label stays internally consistent across midnight-rollover edge
 * cases. When `startedAt` is null (deferred planner entries with no
 * cycles), falls back to date-only (`'May 13'`) formatted directly from
 * the day-only `date` string. APP-71 / APP-78 / APP-88.
 */
export function formatActivityRowDate(date: string, startedAt: string | null): string {
    if (startedAt !== null) {
        return dayjs(startedAt).format('MMM D · HH:mm');
    }
    return dayjs(date).format('MMM D');
}

/**
 * Formats `iso` for the hero's "ends ..." suffix (`'ends 05:48'`) in the
 * device-local timezone. Identical formatter to `formatTimeOfDay`; named
 * separately for grep-ability at call sites.
 */
export function formatEndsAt(iso: string): string {
    return dayjs(iso).format('HH:mm');
}

/**
 * Formats the calendar-day offset between `now` and `iso` into the date
 * label rendered beneath the Home next-run time. Comparisons are anchored
 * in the device-local timezone (APP-88) so a UTC-late instant that still lands
 * on "today" locally doesn't slip into the "Tomorrow" bucket.
 *
 * Buckets:
 *
 * | Offset (calendar days, device-local) | Output             |
 * |--------------------------------------|--------------------|
 * | `<= 0` (today or already past)       | `'Today, 23 May'`  |
 * | `1`                                  | `'Tomorrow, 24 May'` |
 * | `>= 2`                               | `'Tue, 26 May'`    |
 */
export function formatNextRunDate(iso: string, now: Date): string {
    const target = dayjs(iso);
    const targetDay = target.startOf('day');
    const presentDay = dayjs(now).startOf('day');
    const diffDays = targetDay.diff(presentDay, 'day');
    const datePart = target.format('D MMM');
    if (diffDays <= 0) return `Today, ${datePart}`;
    if (diffDays === 1) return `Tomorrow, ${datePart}`;
    return `${target.format('ddd')}, ${datePart}`;
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
