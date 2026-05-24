import type { ScheduleAllowedTimeWindow } from '@/api/types/schedules';

/**
 * Short day labels keyed by ISO weekday (1 = Mon, …, 7 = Sun). Used by
 * `formatDaysCsv` so the lookup matches the API encoding directly.
 */
const DAY_LABEL_BY_WEEKDAY: Readonly<Record<number, string>> = {
    1: 'Mon',
    2: 'Tue',
    3: 'Wed',
    4: 'Thu',
    5: 'Fri',
    6: 'Sat',
    7: 'Sun',
};

/**
 * Sun-first ordering of ISO weekdays — used to sort the CSV and to map
 * Sun-first display positions back to ISO weekdays.
 */
const SUN_FIRST_WEEKDAY_ORDER = [7, 1, 2, 3, 4, 5, 6] as const;

/**
 * Sun-first single-letter day labels. `DayStrip` and `ActiveScheduleChip`
 * both render the mini-strip in this order; co-located here so both
 * components import the canonical sequence.
 */
export const SUN_FIRST_DAY_LETTERS: ReadonlyArray<string> = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/**
 * Sun-first full day names — used for accessibility labels alongside
 * `SUN_FIRST_DAY_LETTERS`.
 */
export const SUN_FIRST_DAY_NAMES: ReadonlyArray<string> = [
    'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
];

/**
 * Converts the API's `allowedDays: number[] | null` (ISO weekday — 1 = Mon,
 * 7 = Sun) into a Sun-first boolean array consumable by `DayStrip` and
 * `DayDots`. Index 0 = Sunday, index 6 = Saturday. `null` (no restriction)
 * → every day.
 */
export function daysArrayFromAllowed(allowedDays: ReadonlyArray<number> | null): boolean[] {
    if (allowedDays === null) return [true, true, true, true, true, true, true];
    return SUN_FIRST_WEEKDAY_ORDER.map(weekday => allowedDays.includes(weekday));
}

/**
 * Formats `allowedDays` as a middot-separated short-day CSV in Sun-first
 * week order (e.g. `Sun · Tue · Fri`). Duplicate or out-of-range entries
 * are filtered out. `null` (no restriction) renders as `Every day`.
 */
export function formatDaysCsv(allowedDays: ReadonlyArray<number> | null): string {
    if (allowedDays === null) return 'Every day';
    const validSet = new Set(allowedDays.filter(day => day >= 1 && day <= 7));
    if (validSet.size === 0) return 'No days';
    const labels = SUN_FIRST_WEEKDAY_ORDER
        .filter(weekday => validSet.has(weekday))
        .map(weekday => DAY_LABEL_BY_WEEKDAY[weekday] as string);
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
