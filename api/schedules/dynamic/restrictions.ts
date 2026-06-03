import dayjs from '@/util/dayjs';

/**
 * One allowed irrigation window within a day. `start` and `end` are
 * `HH:mm` strings interpreted in the site's local timezone. Windows do
 * not wrap past midnight — encode overnight allowances as two windows
 * on consecutive days.
 */
export type ScheduleTimeWindow = {
    start: string;
    end: string;
};

/**
 * Restrictions a schedule applies to the planner's per-day cycle placement.
 * `null` (or an empty array) for either field means "no restriction"; both
 * null is the no-op shape used when no schedule has constraints.
 *
 * `endBySunrise`: when true, the planner narrows each morning allowed window
 * to `[start, min(end, sunrise)]` so no placed cycle can finish post-sunrise.
 * Evening windows (those that start after sunrise) are left untouched.
 */
export type ScheduleRestrictions = {
    allowedDays: number[] | null;
    allowedTimeWindows: ScheduleTimeWindow[] | null;
    endBySunrise?: boolean;
    /**
     * One-shot operator override: when set, the planner drops cycles for the
     * matching entry-date (YYYY-MM-DD). Powers `/schedule/skip-tonight`. The
     * planner treats the skipped day identically to a disallowed weekday —
     * depletion carries forward into the next planned day.
     */
    skippedNightDate?: string | null;
};

/**
 * Closed-open interval the planner can place cycles inside.
 */
export type AllowedInterval = {
    start: dayjs.Dayjs;
    end: dayjs.Dayjs;
};

/**
 * Returns true when the given ISO weekday (1=Mon..7=Sun) is allowed by the
 * restriction's `allowedDays`. Null or empty means "no day restriction" so
 * every day is allowed.
 */
export function isDayAllowed(restrictions: ScheduleRestrictions, isoWeekday: number): boolean {
    const allowed = restrictions.allowedDays;
    if (allowed === null || allowed.length === 0) return true;
    return allowed.includes(isoWeekday);
}

/**
 * Returns true when the operator has marked the given day as skipped via
 * `/schedule/skip-tonight`. Compares the day's `YYYY-MM-DD` against the
 * restriction's `skippedNightDate`; null/undefined means "no skip marker".
 */
export function isNightSkipped(restrictions: ScheduleRestrictions, day: dayjs.Dayjs): boolean {
    const marker = restrictions.skippedNightDate;
    if (marker === null || marker === undefined) return false;
    return day.format('YYYY-MM-DD') === marker;
}

/**
 * Returns the set of allowed time intervals on `day`, anchored as absolute
 * Dayjs values. When `allowedTimeWindows` is null or empty, the whole day is
 * allowed (one interval covering midnight-to-midnight). Skipped silently
 * (returns []) when the day itself is disallowed — callers should consult
 * `isDayAllowed` first.
 *
 * When `restrictions.endBySunrise` is true and `sunrise` is provided, morning
 * windows (those that start before sunrise) are narrowed to end at sunrise.
 * Evening windows (start >= sunrise) are kept as-is.
 *
 * @param day - Reference Dayjs already anchored at midnight in the site's
 *   timezone. The returned intervals share its tz.
 * @param restrictions - Effective restrictions for the active schedule.
 * @param sunrise - Optional sunrise time for the day; required when
 *   `restrictions.endBySunrise` is true to apply morning-window narrowing.
 */
export function computeAllowedIntervalsForDay(
    day: dayjs.Dayjs,
    restrictions: ScheduleRestrictions,
    sunrise?: dayjs.Dayjs,
): AllowedInterval[] {
    if (!isDayAllowed(restrictions, day.isoWeekday())) return [];

    const windows = restrictions.allowedTimeWindows;
    let intervals: AllowedInterval[];
    if (windows === null || windows.length === 0) {
        intervals = [{ start: day.startOf('day'), end: day.add(1, 'day').startOf('day') }];
    } else {
        const base = day.startOf('day');
        intervals = windows
            .map(w => ({
                start: applyHhmm(base, w.start),
                end: applyHhmm(base, w.end),
            }))
            .filter(interval => interval.end.isAfter(interval.start))
            .sort((a, b) => a.start.valueOf() - b.start.valueOf());
    }

    if (restrictions.endBySunrise && sunrise !== undefined) {
        intervals = applyEndBySunrise(intervals, sunrise);
    }

    return intervals;
}

/**
 * Narrows morning windows so no cycle can end after sunrise. Windows that
 * start before sunrise are capped at `[start, min(end, sunrise)]`; windows
 * that start at or after sunrise (evening windows) are kept as-is. Zero-
 * length results (edge case: window starts exactly at sunrise) are dropped.
 */
function applyEndBySunrise(intervals: AllowedInterval[], sunrise: dayjs.Dayjs): AllowedInterval[] {
    return intervals
        .map(interval => {
            if (!interval.start.isBefore(sunrise)) return interval;
            const cappedEnd = interval.end.isAfter(sunrise) ? sunrise : interval.end;
            return { start: interval.start, end: cappedEnd };
        })
        .filter(interval => interval.end.isAfter(interval.start));
}

/**
 * Returns the forbidden gaps within `day` — the complement of the allowed
 * intervals. When the day is fully forbidden, the result is a single
 * interval spanning the whole day. Used as additional busy windows in
 * `deconflictCycles` so forward shifts skip past restricted time.
 *
 * Pass `sunrise` when `restrictions.endBySunrise` is true so the post-sunrise
 * portion of morning windows also appears as a forbidden gap.
 */
export function computeForbiddenIntervalsForDay(
    day: dayjs.Dayjs,
    restrictions: ScheduleRestrictions,
    sunrise?: dayjs.Dayjs,
): AllowedInterval[] {
    const dayStart = day.startOf('day');
    const dayEnd = day.add(1, 'day').startOf('day');

    if (!isDayAllowed(restrictions, day.isoWeekday())) {
        return [{ start: dayStart, end: dayEnd }];
    }

    const allowed = computeAllowedIntervalsForDay(day, restrictions, sunrise);
    if (allowed.length === 0) return [{ start: dayStart, end: dayEnd }];

    const gaps: AllowedInterval[] = [];
    let cursor = dayStart;
    for (const interval of allowed) {
        if (interval.start.isAfter(cursor)) {
            gaps.push({ start: cursor, end: interval.start });
        }
        if (interval.end.isAfter(cursor)) {
            cursor = interval.end;
        }
    }
    if (dayEnd.isAfter(cursor)) {
        gaps.push({ start: cursor, end: dayEnd });
    }
    return gaps;
}

/**
 * Picks an anchor instant to hand to `buildCyclePlan`, given the day's
 * allowed intervals and the irrigation block's required span. Preference
 * is the latest allowed interval whose end is ≤ sunrise — that preserves
 * the planner's "fire just before sunrise" heuristic. Falls back to the
 * latest allowed interval today that can hold the span. Returns null when
 * no single interval can fit the block.
 *
 * @param allowedIntervals - Pre-computed by `computeAllowedIntervalsForDay`.
 * @param sunrise - Day's sunrise (or default 06:00) in the site's tz.
 * @param requiredSpanMinutes - `totalRunTime + (numCycles-1)*soakTime`.
 */
export function pickAnchorForCycles(
    allowedIntervals: ReadonlyArray<AllowedInterval>,
    sunrise: dayjs.Dayjs,
    requiredSpanMinutes: number,
): dayjs.Dayjs | null {
    if (allowedIntervals.length === 0) return null;
    if (requiredSpanMinutes <= 0) return null;
    const spanMs = requiredSpanMinutes * 60_000;

    const fits = allowedIntervals.filter(interval =>
        (interval.end.valueOf() - interval.start.valueOf()) >= spanMs);
    if (fits.length === 0) return null;

    // Preference 1: the interval that contains sunrise. Anchor at sunrise
    // itself when there's room before it; otherwise anchor at the interval's
    // end so cycles still fit but end after sunrise.
    const containing = fits.find(i =>
        !i.start.isAfter(sunrise) && !i.end.isBefore(sunrise));
    if (containing !== undefined) {
        const canFitEndingAtSunrise = (sunrise.valueOf() - containing.start.valueOf()) >= spanMs;
        return canFitEndingAtSunrise ? sunrise : containing.end;
    }

    // Preference 2: the latest interval whose end is ≤ sunrise (entirely
    // pre-sunrise — common when sunrise is in a forbidden gap).
    const beforeSunrise = fits.filter(i => !i.end.isAfter(sunrise));
    if (beforeSunrise.length > 0) {
        return beforeSunrise[beforeSunrise.length - 1]!.end;
    }

    // Preference 3: the latest interval today that fits, regardless of
    // position vs. sunrise (evening window for a very late sunrise).
    return fits[fits.length - 1]!.end;
}

function applyHhmm(base: dayjs.Dayjs, hhmm: string): dayjs.Dayjs {
    const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
    if (!match) {
        throw new Error(`schedule-restrictions: invalid HH:mm value '${hhmm}'.`);
    }
    const hour = Number.parseInt(match[1]!, 10);
    const minute = Number.parseInt(match[2]!, 10);
    if (!Number.isFinite(hour) || hour < 0 || hour > 23) {
        throw new Error(`schedule-restrictions: hour out of range in '${hhmm}'.`);
    }
    if (!Number.isFinite(minute) || minute < 0 || minute > 59) {
        throw new Error(`schedule-restrictions: minute out of range in '${hhmm}'.`);
    }
    return base.hour(hour).minute(minute).second(0).millisecond(0);
}
