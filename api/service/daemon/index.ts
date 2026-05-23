import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { clearAlertsByClass, noopAlerter, type Alerter } from '@/alerts';
import {
    closeZone as defaultCloseZone,
    getZoneState as defaultGetZoneState,
    openZone as defaultOpenZone,
    type ZoneRelayState,
} from '@/data/home-assistant';
import type { Zone } from '@/models';
import type { PersistedCycle } from '@/models/cycle';
import { noopNotifier, type Notifier } from '@/notifications';
import { runScheduleForZone, type RunScheduleForZoneOptions } from '@/schedules';
import type { PlanZoneScheduleResult } from '@/schedules/dynamic';
import { getSystemState } from '@/service/system';
import { reconcileCycleAndRelayState, type ReconcileSummary } from './reconcile';
import {
    armCloseOnly,
    armCycle,
    closeAllInFlight,
    realClock,
    TimerRegistry,
    type Clock,
    type ScheduleEndMarker,
    type ScheduleStartMarker,
} from './runtime';
import {
    getAlertsDb,
    getScheduleEntriesRepo,
    getSchedulesRepo,
    getSitesRepo,
    getWeatherStateRepo,
    getZonesRepo,
    setDaemonRepos,
    type DaemonServiceRepos,
    type SetDaemonReposInput,
} from './state';

dayjs.extend(utc);
dayjs.extend(timezone);

const DEFAULT_REPLAN_HOUR_LOCAL = 4;

export type BootDaemonServiceInput = SetDaemonReposInput;

/**
 * Wires the daemon service to its repositories. Call once at process boot;
 * call in test `beforeEach` with object-literal fake repos. All service
 * functions (and the runtime / reconcile sub-modules) read from this state.
 */
export function bootDaemonService(input: BootDaemonServiceInput): void {
    setDaemonRepos(input);
}

/**
 * Caller-overridable hooks. Defaults wire to the real planning function and
 * the real Home Assistant client. The clock defaults to `realClock`.
 */
export type DaemonOptions = {
    rePlanHourLocal?: number;
    runPlan?: (zone: Zone, options?: RunScheduleForZoneOptions) => Promise<PlanZoneScheduleResult>;
    openZone?: (zone: Zone) => Promise<void>;
    closeZone?: (zone: Zone) => Promise<void>;
    getZoneState?: (zone: Zone) => Promise<ZoneRelayState>;
    clock?: Clock;
    siteTimezone?: string;
    notifier?: Notifier;
    alerter?: Alerter;
};

/**
 * Snapshot of the daemon's runtime state for the HTTP `/health` endpoint.
 */
export type DaemonStatus = {
    alive: boolean;
    lastRePlanAt: string | null;
    activeZones: ReadonlyArray<{ id: string; name: string }>;
};

/**
 * Control surface returned from `start`. Lets the unified entrypoint (and
 * tests) drive the daemon without reaching into its internals.
 */
export type DaemonControl = {
    rePlan: () => Promise<void>;
    shutdown: () => Promise<void>;
    getStatus: () => DaemonStatus;
};

/**
 * Re-export the repo type so api/index.ts can construct it without importing
 * from the internal state module.
 */
export type { DaemonServiceRepos };

/**
 * Boots the daemon: arms whatever future cycles already exist in the DB and
 * schedules the next daily re-plan. Reads repositories from the module-level
 * state set by `bootDaemonService`.
 */
export async function start(options?: DaemonOptions): Promise<DaemonControl> {
    const clock = options?.clock ?? realClock;
    const rePlanHourLocal = options?.rePlanHourLocal ?? DEFAULT_REPLAN_HOUR_LOCAL;
    const runPlan = options?.runPlan ?? ((zone, opts) => runScheduleForZone(zone, opts));
    const openZone = options?.openZone ?? defaultOpenZone;
    const closeZone = options?.closeZone ?? defaultCloseZone;
    const getZoneState = options?.getZoneState ?? defaultGetZoneState;

    const registry = new TimerRegistry();
    const notifier = options?.notifier ?? noopNotifier;
    const alerter = options?.alerter ?? noopAlerter;
    let lastRePlanAt: Date | null = null;
    let started = false;

    const sitesRepo = getSitesRepo();
    const zonesRepo = getZonesRepo();
    const schedulesRepo = getSchedulesRepo();
    const scheduleEntriesRepo = getScheduleEntriesRepo();
    const weatherStateRepo = getWeatherStateRepo();

    const siteTimezone = options?.siteTimezone ?? await sitesRepo.loadTimezone();

    console.log(`daemon: starting (re-plan hour: ${rePlanHourLocal}:00 ${siteTimezone}).`);

    const enabledZonesAtBoot = await zonesRepo.loadEnabled();
    const reconcileSummary: ReconcileSummary = await reconcileCycleAndRelayState({
        clock,
        registry,
        notifier,
        alerter,
        closeZone,
        getZoneState,
        armCloseOnly,
        managedZones: enabledZonesAtBoot.filter(z => z.homeAssistantEntityId !== undefined),
    });
    console.log(`daemon: reconcile summary — resumed: ${reconcileSummary.resumed}, forcedClosed: ${reconcileSummary.forcedClosed}, missedClose: ${reconcileSummary.missedClose}, orphansClosed: ${reconcileSummary.orphansClosed}, errors: ${reconcileSummary.errors}.`);

    const futureCycles = await scheduleEntriesRepo.loadFutureCycles(clock.now());
    const systemAtBoot = await getSystemState();
    if (!systemAtBoot.irrigationEnabled) {
        console.warn(`daemon: system irrigation is disabled (since ${systemAtBoot.since}); skipping arm of ${futureCycles.length} future cycle(s).`);
    } else {
        for (const { cycle, zone } of futureCycles) {
            armCycle({ clock, registry, zone, cycle, openZone, closeZone, notifier, alerter });
        }
    }

    const { total, enabled } = await zonesRepo.count();
    if (total === 0) {
        console.warn('daemon: has no zones to manage. Did you run `bun run seed`? Daemon is idle until zones are added.');
    } else if (enabled === 0) {
        console.warn('daemon: all zones are disabled. Daemon is idle until at least one zone is enabled.');
    }

    const scheduleNextRePlan = (): void => {
        const next = computeNextRePlanAt(clock.now(), rePlanHourLocal, siteTimezone);
        const delay = Math.max(0, next.getTime() - clock.now().getTime());
        console.log(`daemon: next re-plan scheduled at ${next.toISOString()} (${delay}ms from now).`);
        const handle = clock.setTimeout(() => {
            rePlan().catch(err => {
                console.error('daemon: unhandled error in scheduled re-plan.', err);
            });
        }, delay);
        registry.setRePlanHandle(handle);
    };

    const rePlan = async (): Promise<void> => {
        console.log('daemon: re-plan starting.');
        registry.cancelOpenTimers(clock);

        const system = await getSystemState();
        if (!system.irrigationEnabled) {
            console.warn(`daemon: re-plan skipped — system irrigation is disabled (since ${system.since}). All armed cycles cancelled; no new cycles will arm until re-enabled.`);
            lastRePlanAt = clock.now();
            scheduleNextRePlan();
            return;
        }

        const today = dayjs(clock.now());
        await schedulesRepo.clearStaleSkipMarkers(today);

        const enabledZones = await zonesRepo.loadEnabled();
        const activeSchedulesBySite = await schedulesRepo.loadActiveBySite();
        const now = clock.now();
        const busyWindows: Array<{ start: Date; end: Date }> = registry.snapshotInFlight()
            .map(({ endTime }) => ({ start: now, end: endTime }));
        const pastWindow: { start: Date; end: Date } = { start: new Date(0), end: now };

        const cyclesToArm: Array<{ zone: Zone; cycle: PersistedCycle }> = [];

        for (const zone of enabledZones) {
            const activeSchedule = activeSchedulesBySite.get(zone.siteId);
            if (!activeSchedule) {
                console.warn(`daemon: no active schedule for site ${zone.siteId} — skipping zone ${zone.id} (${zone.name}).`);
                continue;
            }

            try {
                const restrictions = {
                    allowedDays: activeSchedule.allowedDays,
                    allowedTimeWindows: activeSchedule.allowedTimeWindows,
                    endBySunrise: activeSchedule.endBySunrise ?? false,
                    skippedNightDate: activeSchedule.skippedNightDate ?? null,
                };
                const overrides = {
                    rootDepthM: activeSchedule.rootDepthMOverride ?? undefined,
                    allowableDepletionFraction: activeSchedule.allowableDepletionFractionOverride ?? undefined,
                };
                const { entries, projectedNextDepletionMm } = await runPlan(zone, {
                    busyWindows: [pastWindow, ...busyWindows],
                    restrictions,
                    overrides,
                    forecastDays: 14,
                });
                const { cycles } = await scheduleEntriesRepo.replaceForZone(
                    zone.id, entries, today, projectedNextDepletionMm, activeSchedule.id,
                );
                for (const cycle of cycles) {
                    const cycleEnd = new Date(cycle.startTime.getTime() + cycle.durationMin * 60_000);
                    const overlaps = busyWindows.some(w => cycle.startTime < w.end && cycleEnd > w.start);
                    if (overlaps) {
                        console.warn(`daemon: cycle ${cycle.id} for zone ${zone.id} (${zone.name}) overlaps a busy window — not arming.`);
                        continue;
                    }
                    cyclesToArm.push({ zone, cycle });
                    busyWindows.push({ start: cycle.startTime, end: cycleEnd });
                }
                // Successful runPlan implies a successful weather fetch — refresh
                // the staleness timestamp and clear any lingering unacked
                // weather-stale alert so the UI region collapses on recovery.
                const alertsDb = getAlertsDb();
                await Promise.all([
                    weatherStateRepo.markFetchSuccessful(clock.now()),
                    alertsDb ? clearAlertsByClass(alertsDb, 'weather-stale') : Promise.resolve(),
                ]);
            } catch (err) {
                const reason = err instanceof Error ? err.message : String(err);
                console.error(`daemon: re-plan failed for zone ${zone.id}.`, err);
                if (await weatherStateRepo.isStale(clock.now())) {
                    await alerter({
                        class: 'weather-stale',
                        tone: 'warn',
                        title: 'Weather API stale',
                        sub: `Planner using fallback ET zero. Last fetch error: ${reason}.`,
                        zoneName: zone.name,
                    });
                }
            }
        }

        armCyclesWithScheduleMarkers(cyclesToArm, siteTimezone, ({ zone, cycle, scheduleStart, scheduleEnd }) => {
            armCycle({ clock, registry, zone, cycle, openZone, closeZone, notifier, alerter, scheduleStart, scheduleEnd });
        });

        lastRePlanAt = clock.now();
        scheduleNextRePlan();
        console.log('daemon: re-plan complete.');
    };

    const shutdown = async (): Promise<void> => {
        console.log('daemon: shutdown starting.');
        registry.cancelAllTimers(clock);
        await closeAllInFlight({ clock, registry, closeZone, alerter });
        console.log('daemon: shutdown complete.');
    };

    scheduleNextRePlan();
    started = true;

    const getStatus = (): DaemonStatus => ({
        alive: started,
        lastRePlanAt: lastRePlanAt === null ? null : lastRePlanAt.toISOString(),
        activeZones: registry.snapshotInFlight().map(({ zone }) => ({ id: zone.id, name: zone.name })),
    });

    return { rePlan, shutdown, getStatus };
}

/**
 * Returns the next wall-clock occurrence of `hourLocal:00` after `now`,
 * resolved against the supplied IANA timezone. Pure function exported so the
 * scheduling math is unit-testable directly.
 */
export function computeNextRePlanAt(now: Date, hourLocal: number, tz: string): Date {
    const ref = dayjs(now).tz(tz);
    const todayAtHour = ref.hour(hourLocal).minute(0).second(0).millisecond(0);
    const next = todayAtHour.isAfter(ref) ? todayAtHour : todayAtHour.add(1, 'day');
    return next.toDate();
}

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
