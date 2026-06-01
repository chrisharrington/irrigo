import type { AlertsDb } from '@/alerts';
import type { Database } from '@/db';
import {
    createScheduleEntriesRepository,
    type ScheduleEntriesRepository,
} from '@/repositories/schedule-entries';
import {
    createSchedulingDecisionsRepository,
    type SchedulingDecisionsRepository,
} from '@/repositories/scheduling-decisions';
import { createSchedulesRepository, type SchedulesRepository } from '@/repositories/schedules';
import { createSitesRepository, type SitesRepository } from '@/repositories/sites';
import { createWeatherSnapshotsRepository, type WeatherSnapshotsRepository } from '@/repositories/weather-snapshots';
import { createWeatherStateRepository, type WeatherStateRepository } from '@/repositories/weather-state';
import { createZonesRepository, type ZonesRepository } from '@/repositories/zones';

/**
 * Collection of all repositories the daemon service tier needs. Held as
 * module-level state once `bootDaemonService` runs; sub-modules (`runtime`,
 * `reconcile`) reach in via the accessor functions below rather than via
 * function parameters, so call sites stay clean.
 */
export type DaemonServiceRepos = {
    zones: ZonesRepository;
    sites: SitesRepository;
    schedules: SchedulesRepository;
    scheduleEntries: ScheduleEntriesRepository;
    schedulingDecisions: SchedulingDecisionsRepository;
    weatherState: WeatherStateRepository;
    weatherSnapshots: WeatherSnapshotsRepository;
};

/**
 * Input shape for the internal `setDaemonRepos`. Production passes `{ db }` so
 * the boot constructs production repositories; tests pass `{ repos }` with
 * object-literal fakes (and may optionally pass `alertsDb` to capture
 * `clearAlertsByClass` calls).
 */
export type SetDaemonReposInput =
    | { db: Database }
    | { repos: DaemonServiceRepos; alertsDb?: AlertsDb };

let repos: DaemonServiceRepos | null = null;
let alertsDb: AlertsDb | null = null;

/**
 * Internal — called by `bootDaemonService`. Not exported from `service/daemon/`
 * but is exported from this file so tests can call it directly if they prefer
 * not to go through `bootDaemonService`.
 */
export function setDaemonRepos(input: SetDaemonReposInput): void {
    if ('repos' in input) {
        repos = input.repos;
        alertsDb = input.alertsDb ?? null;
    } else {
        repos = {
            zones: createZonesRepository(input.db),
            sites: createSitesRepository(input.db),
            schedules: createSchedulesRepository(input.db),
            scheduleEntries: createScheduleEntriesRepository(input.db),
            schedulingDecisions: createSchedulingDecisionsRepository(input.db),
            weatherState: createWeatherStateRepository(input.db),
            weatherSnapshots: createWeatherSnapshotsRepository(input.db),
        };
        alertsDb = input.db as unknown as AlertsDb;
    }
}

function getRepos(): DaemonServiceRepos {
    if (!repos) {
        throw new Error('Daemon service not booted — call bootDaemonService({ db }) at startup.');
    }
    return repos;
}

export function getZonesRepo(): ZonesRepository {
    return getRepos().zones;
}

export function getSitesRepo(): SitesRepository {
    return getRepos().sites;
}

export function getSchedulesRepo(): SchedulesRepository {
    return getRepos().schedules;
}

export function getScheduleEntriesRepo(): ScheduleEntriesRepository {
    return getRepos().scheduleEntries;
}

export function getSchedulingDecisionsRepo(): SchedulingDecisionsRepository {
    return getRepos().schedulingDecisions;
}

export function getWeatherStateRepo(): WeatherStateRepository {
    return getRepos().weatherState;
}

export function getWeatherSnapshotsRepo(): WeatherSnapshotsRepository {
    return getRepos().weatherSnapshots;
}

/**
 * Returns the alerts-compatible db handle for the alerts module's
 * `clearAlertsByClass`. Returns `null` only if the daemon was booted via
 * `{ repos }` without explicit `alertsDb` — tests that don't exercise the
 * alerts clear path can leave it null.
 */
export function getAlertsDb(): AlertsDb | null {
    return alertsDb;
}
