import type { ScheduleAllowedTimeWindow } from '@/api/types/schedules';

/**
 * Mon-Sun day labels for the CSV summary. Order matches `isoWeekday`
 * (1 = Mon, 7 = Sun) shifted to a 0-based array index.
 */
const DAY_CSV_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

/**
 * Converts the API's `allowedDays: number[] | null` (ISO weekday — 1 = Mon,
 * 7 = Sun) into a Mon-Sun-anchored boolean array consumable by `DayStrip`
 * and `DayDots`. `null` (no restriction) → every day.
 */
export function daysArrayFromAllowed(allowedDays: ReadonlyArray<number> | null): boolean[] {
    if (allowedDays === null) return [true, true, true, true, true, true, true];
    return Array.from({ length: 7 }, (_, index) => allowedDays.includes(index + 1));
}

/**
 * Formats `allowedDays` as a middot-separated short-day CSV (e.g.
 * `Mon · Wed · Fri`). `null` (no restriction) renders as `Every day`.
 */
export function formatDaysCsv(allowedDays: ReadonlyArray<number> | null): string {
    if (allowedDays === null) return 'Every day';
    const labels = allowedDays
        .filter(day => day >= 1 && day <= 7)
        .map(day => DAY_CSV_LABELS[day - 1] as string);
    if (labels.length === 0) return 'No days';
    return labels.join(' · ');
}

/**
 * Formats the time-window list as `HH:MM → HH:MM` (single window) or a
 * comma-separated list (multiple). `null` / empty → `Any time`.
 */
export function formatTimeWindow(allowedTimeWindows: ReadonlyArray<ScheduleAllowedTimeWindow> | null): string {
    if (allowedTimeWindows === null || allowedTimeWindows.length === 0) return 'Any time';
    return allowedTimeWindows.map(window => `${window.start} → ${window.end}`).join(', ');
}
