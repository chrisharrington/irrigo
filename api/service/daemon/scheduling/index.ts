import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

/**
 * Distinguishes the daemon's two scheduled ticks. The morning tick
 * (~sunrise+60min) reconciles depletion against actual HA actuation history
 * for the prior night; the evening tick (20:00 local) advances depletion
 * through the day's observed weather and forward-plans tonight's cycles.
 */
export type TickKind = 'morning' | 'evening';

/**
 * Returns the next wall-clock occurrence of `hourLocal:00` after `now`,
 * resolved against the supplied IANA timezone. Pure function so the
 * scheduling math is unit-testable directly.
 */
export function computeNextRePlanAt(now: Date, hourLocal: number, tz: string): Date {
    const ref = dayjs(now).tz(tz);
    const todayAtHour = ref.hour(hourLocal).minute(0).second(0).millisecond(0);
    const next = todayAtHour.isAfter(ref) ? todayAtHour : todayAtHour.add(1, 'day');
    return next.toDate();
}

/**
 * Returns `sunrise + offsetMinutes` if that instant is still in the future
 * relative to `now`; otherwise `null`. Used by `pickNextTick` to decide
 * whether the next scheduled fire is the morning reconciliation tick or
 * the evening forward-plan tick. When the latest known sunrise has already
 * passed (or no sunrise has been observed yet), the daemon falls back to
 * scheduling the evening tick only, and the next successful weather fetch
 * refreshes the morning anchor.
 */
export function computeNextMorningAt(now: Date, sunrise: Date | null, offsetMinutes: number): Date | null {
    if (sunrise === null) return null;
    const candidate = new Date(sunrise.getTime() + offsetMinutes * 60_000);
    if (candidate.getTime() <= now.getTime()) return null;
    return candidate;
}

/**
 * Picks the soonest sunrise from a daily-weather array whose
 * `sunrise + offsetMinutes` is still in the future relative to `at`. Returns
 * `null` if no entry qualifies (e.g. the last day of the horizon already
 * morning-ticked). Pure — used by both the boot weather seed and the
 * per-tick weather refresh to update the morning-tick anchor.
 */
export function pickUpcomingSunrise(
    daily: ReadonlyArray<{ sunrise?: dayjs.Dayjs }>,
    at: Date,
    offsetMinutes: number,
): Date | null {
    const thresholdMs = at.getTime() - offsetMinutes * 60_000;
    for (const day of daily) {
        const candidate = day.sunrise?.toDate();
        if (candidate && candidate.getTime() > thresholdMs) return candidate;
    }
    return null;
}

/**
 * Inputs for `pickNextTick`. The daemon supplies its current state and the
 * function returns the next tick's kind and wall-clock time. No side
 * effects — the caller is responsible for installing the timer.
 */
export type PickNextTickInput = {
    now: Date;
    eveningHourLocal: number;
    siteTimezone: string;
    latestKnownSunrise: Date | null;
    morningOffsetMinutes: number;
};

/**
 * Returns the soonest of (next morning tick, next evening tick), tagged with
 * its kind. Morning is null until a weather fetch has populated
 * `latestKnownSunrise`, in which case evening is always picked.
 */
export function pickNextTick(input: PickNextTickInput): { kind: TickKind; at: Date } {
    const { now, eveningHourLocal, siteTimezone, latestKnownSunrise, morningOffsetMinutes } = input;
    const nextEvening = computeNextRePlanAt(now, eveningHourLocal, siteTimezone);
    const nextMorning = computeNextMorningAt(now, latestKnownSunrise, morningOffsetMinutes);
    if (nextMorning !== null && nextMorning.getTime() < nextEvening.getTime()) {
        return { kind: 'morning', at: nextMorning };
    }
    return { kind: 'evening', at: nextEvening };
}
