import type { Zone } from '@/models';

/**
 * Compact representation of an inserted irrigation cycle, scoped to what the
 * runtime needs to arm timers and update the row on fire/close. `entryDate`
 * carries the `schedule_entries.date` (YYYY-MM-DD in site timezone) so the
 * daemon can group cycles by irrigation night when deciding which gets the
 * `schedule-begun` / `schedule-ended` notification flags.
 */
export type PersistedCycle = {
    id: string;
    startTime: Date;
    durationMin: number;
    entryDate: string;
};

/**
 * Pair returned by the schedule-entries repository's future/in-flight cycle
 * loaders: a runtime-ready cycle plus the fully-formed zone it belongs to.
 */
export type FutureCyclePair = {
    cycle: PersistedCycle;
    zone: Zone;
};
