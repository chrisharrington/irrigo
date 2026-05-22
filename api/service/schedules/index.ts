import type dayjs from 'dayjs';
import type { Database } from '@/db';
import {
    createSchedulesRepository,
    type Schedule,
    type SchedulesRepository,
} from '@/repositories/schedules';

export type { Schedule } from '@/repositories/schedules';

/**
 * Input to `bootSchedulesService`. Production passes `{ db }`; tests pass
 * `{ repo }` with an object-literal fake.
 */
export type BootSchedulesServiceInput =
    | { db: Database }
    | { repo: SchedulesRepository };

let repo: SchedulesRepository | null = null;

/**
 * Wires the schedules service to its repository. Call once at process boot;
 * call again in test `beforeEach` with a fake to isolate behavior.
 */
export function bootSchedulesService(input: BootSchedulesServiceInput): void {
    repo = 'repo' in input ? input.repo : createSchedulesRepository(input.db);
}

function getRepo(): SchedulesRepository {
    if (!repo) {
        throw new Error('Schedules service not booted — call bootSchedulesService({ db }) at startup.');
    }
    return repo;
}

/** Returns the active schedules grouped by site id. */
export async function loadActiveSchedulesBySite(): Promise<Map<string, Schedule>> {
    return getRepo().loadActiveBySite();
}

/** Returns the schedule with the given slug, or `null` if no such row exists. */
export async function loadScheduleBySlug(slug: string): Promise<Schedule | null> {
    return getRepo().findBySlug(slug);
}

/** Atomically activates the slug and deactivates any sibling on the same site. */
export async function enableSchedule(slug: string): Promise<Schedule | null> {
    return getRepo().enable(slug);
}

/** Deactivates the slug. Idempotent. Returns null when the slug is unknown. */
export async function disableSchedule(slug: string): Promise<Schedule | null> {
    return getRepo().disable(slug);
}

/** Sets `skippedNightDate = today` on the (single) active schedule. */
export async function skipActiveScheduleTonight(today: dayjs.Dayjs): Promise<Schedule | null> {
    return getRepo().skipActiveTonight(today);
}

/** Clears `skippedNightDate` on the (single) active schedule. */
export async function resumeActiveScheduleTonight(): Promise<Schedule | null> {
    return getRepo().resumeActiveTonight();
}

/** Clears any `skippedNightDate` strictly older than `today`. */
export async function clearStaleSkipMarkers(today: dayjs.Dayjs): Promise<void> {
    return getRepo().clearStaleSkipMarkers(today);
}
