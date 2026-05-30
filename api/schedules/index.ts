import dayjs from 'dayjs';
import { getWeatherData } from '../data/weather';
import type { Zone } from '../models';
import { DEFAULT_RAIN_SKIP_LOOKAHEAD_DAYS, planZoneSchedule, type BusyWindow, type PlanZoneScheduleResult, type ScheduleOverrides } from './dynamic';
import type { ScheduleRestrictions } from './dynamic/restrictions';

/**
 * Resolves the planner's rain-skip lookahead horizon from the
 * `RAIN_SKIP_LOOKAHEAD_DAYS` environment variable. Accepts any non-negative
 * integer (0 disables the rain-skip); falls back to
 * `DEFAULT_RAIN_SKIP_LOOKAHEAD_DAYS` when unset, non-numeric, or negative.
 * Exported for direct testing.
 */
export function resolveRainSkipLookaheadDays(raw: string | undefined): number {
    if (raw === undefined) return DEFAULT_RAIN_SKIP_LOOKAHEAD_DAYS;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_RAIN_SKIP_LOOKAHEAD_DAYS;
}

export type RunScheduleForZoneOptions = {
    /** Optional. Number of days of forecast weather to plan against. Default 7. */
    forecastDays?: number;

    /**
     * Optional. Time intervals already occupied by other zones' cycles. The
     * planner shifts conflicting cycles forward to avoid overlap. The daemon
     * passes already-persisted cycles' `[startTime, startTime + duration]`
     * windows so subsequent zones plan around them.
     */
    busyWindows?: ReadonlyArray<{ start: Date; end: Date }>;

    /**
     * Optional. Day/time-window restrictions from the active schedule.
     * `null`/empty fields mean "no restriction" for that dimension.
     */
    restrictions?: ScheduleRestrictions;

    /**
     * Optional. Per-schedule planner-parameter overrides. Both fields
     * `undefined` means "no override" — planner reads the zone's own
     * `rootDepthM` / `allowableDepletionFraction`.
     */
    overrides?: ScheduleOverrides;
};

/**
 * Orchestrates a full planning run for a zone: fetches weather for the zone's
 * location and hands it to planZoneSchedule. The caller is responsible for
 * sourcing the zone (and resolving site-fallback coordinates if the zone's own
 * location is null) — this function does not load anything from disk or DB.
 *
 * @param zone - The fully-formed irrigation zone. Must have a non-null location.
 * @param options - Orchestration options.
 * @returns Per-day schedule entries plus the projected next-day starting
 *   depletion, which the daemon persists so tomorrow's re-plan starts honest.
 * @throws Error if zone.location is undefined.
 */
export async function runScheduleForZone(
    zone: Zone,
    options?: RunScheduleForZoneOptions
): Promise<PlanZoneScheduleResult> {
    if (!zone.location) {
        throw new Error(`runScheduleForZone: zone ${zone.id} has no location; caller must resolve coordinates before calling.`);
    }

    const forecastDays = options?.forecastDays ?? 7;

    console.log(`runScheduleForZone: planning zone ${zone.id} at (${zone.location.lat}, ${zone.location.lon}) over ${forecastDays} day(s).`);

    const { daily } = await getWeatherData({
        latitude: zone.location.lat,
        longitude: zone.location.lon,
        forecastDays,
        timezone: zone.siteTimezone,
    });

    const busyWindows: BusyWindow[] = (options?.busyWindows ?? []).map(w => ({
        start: dayjs(w.start),
        end: dayjs(w.end),
    }));

    const rainSkipLookaheadDays = resolveRainSkipLookaheadDays(process.env.RAIN_SKIP_LOOKAHEAD_DAYS);

    return planZoneSchedule(zone, daily, busyWindows, options?.restrictions, options?.overrides, rainSkipLookaheadDays);
}
