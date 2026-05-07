import { getWeatherData } from '../data/weather';
import type { Zone } from '../models';
import { planZoneSchedule, type PlanZoneScheduleResult } from './dynamic';

export type RunScheduleForZoneOptions = {
    /** Optional. Number of days of forecast weather to plan against. Default 7. */
    forecastDays?: number;
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

    const weather = await getWeatherData({
        latitude: zone.location.lat,
        longitude: zone.location.lon,
        forecastDays,
    });

    return planZoneSchedule(zone, weather);
}
