import type { Zone } from '@/models';
import type { PersistedCycle } from '@/models/cycle';
import type { ScheduleEndMarker, ScheduleStartMarker } from '../runtime';

/**
 * Tagged cycle ready for `armCycle`. Marker fields decide whether the runtime
 * emits `schedule-begun` / `schedule-ended` after the cycle's open/close.
 */
export type ArmableCycle = {
    zone: Zone;
    cycle: PersistedCycle;
    scheduleStart?: ScheduleStartMarker;
    scheduleEnd?: ScheduleEndMarker;
};

/**
 * Groups cycles by their `entryDate` (one entry-date = one irrigation
 * night), sorts each group by start time, and tags the earliest cycle of
 * each group with `scheduleStart` and the latest with `scheduleEnd`.
 */
export function armCyclesWithScheduleMarkers(
    cyclesToArm: ReadonlyArray<{ zone: Zone; cycle: PersistedCycle }>,
    siteTimezone: string,
    arm: (input: ArmableCycle) => void,
): void {
    if (cyclesToArm.length === 0) return;

    const byNight = new Map<string, Array<{ zone: Zone; cycle: PersistedCycle }>>();
    for (const c of cyclesToArm) {
        const group = byNight.get(c.cycle.entryDate) ?? [];
        group.push(c);
        byNight.set(c.cycle.entryDate, group);
    }

    const nights = [...byNight.keys()].sort();
    for (const group of byNight.values()) {
        group.sort((a, b) => a.cycle.startTime.getTime() - b.cycle.startTime.getTime());
    }

    for (let i = 0; i < nights.length; i++) {
        const night = nights[i]!;
        const group = byNight.get(night)!;
        const first = group[0]!;
        const last = group[group.length - 1]!;

        const perZoneRuntimeMin: Record<string, number> = {};
        for (const { zone, cycle } of group) {
            perZoneRuntimeMin[zone.name] = (perZoneRuntimeMin[zone.name] ?? 0) + cycle.durationMin;
        }

        const nextNight = i + 1 < nights.length ? byNight.get(nights[i + 1]!) : undefined;
        const nextFirst = nextNight?.[0];
        const scheduleEnd: ScheduleEndMarker = {
            scheduleNight: night,
            perZoneRuntimeMin,
            siteTimezone,
            ...(nextFirst ? { nextIrrigation: { zoneName: nextFirst.zone.name, startTime: nextFirst.cycle.startTime } } : {}),
        };
        const scheduleStart: ScheduleStartMarker = { scheduleNight: night };

        for (const item of group) {
            arm({
                zone: item.zone,
                cycle: item.cycle,
                ...(item === first ? { scheduleStart } : {}),
                ...(item === last ? { scheduleEnd } : {}),
            });
        }
    }
}
