import type { Alerter } from '@/alerts';
import type { Zone } from '@/models';
import type { PersistedCycle } from '@/models/cycle';
import type { Notifier } from '@/notifications';
import { getScheduleEntriesRepo, getZonesRepo } from './state';

/**
 * Opaque handle returned by `Clock.setTimeout`. The runtime doesn't introspect
 * it — production wiring uses Node's setTimeout which returns a Timeout
 * object, while tests use numeric handles.
 */
export type TimerHandle = unknown;

/**
 * Abstraction over time-related globals so the daemon's timing can be driven
 * deterministically in tests. Production wiring is the `realClock` below.
 */
export type Clock = {
    /** Returns the current wall-clock time. */
    now: () => Date;

    /** Schedules `cb` to run after `ms` milliseconds and returns a cancel handle. */
    setTimeout: (cb: () => void, ms: number) => TimerHandle;

    /** Cancels a previously-scheduled timer. */
    clearTimeout: (handle: TimerHandle) => void;
};

/**
 * Production `Clock` implementation backed by the host JS runtime.
 */
export const realClock: Clock = {
    now: () => new Date(),
    setTimeout: (cb, ms) => globalThis.setTimeout(cb, ms),
    clearTimeout: (handle) => globalThis.clearTimeout(handle as Parameters<typeof globalThis.clearTimeout>[0]),
};

/**
 * Tracks timers and in-flight cycles so the daemon can tear things down in
 * the right order on `rePlan` and `shutdown`.
 */
export class TimerRegistry {
    private readonly openHandles = new Set<TimerHandle>();
    private readonly inFlight = new Map<string, { zone: Zone; closeHandle: TimerHandle; endTime: Date }>();
    private rePlanHandle: TimerHandle | undefined;

    addOpen(handle: TimerHandle): void {
        this.openHandles.add(handle);
    }

    consumeOpen(handle: TimerHandle): void {
        this.openHandles.delete(handle);
    }

    addInFlight(cycleId: string, zone: Zone, closeHandle: TimerHandle, endTime: Date): void {
        this.inFlight.set(cycleId, { zone, closeHandle, endTime });
    }

    clearInFlight(cycleId: string): void {
        this.inFlight.delete(cycleId);
    }

    setRePlanHandle(handle: TimerHandle | undefined): void {
        this.rePlanHandle = handle;
    }

    cancelOpenTimers(clock: Clock): void {
        for (const handle of this.openHandles) clock.clearTimeout(handle);
        this.openHandles.clear();
    }

    cancelAllTimers(clock: Clock): void {
        this.cancelOpenTimers(clock);
        for (const { closeHandle } of this.inFlight.values()) clock.clearTimeout(closeHandle);
        if (this.rePlanHandle !== undefined) {
            clock.clearTimeout(this.rePlanHandle);
            this.rePlanHandle = undefined;
        }
    }

    snapshotInFlight(): ReadonlyArray<{ cycleId: string; zone: Zone; endTime: Date }> {
        return [...this.inFlight.entries()].map(([cycleId, value]) => ({ cycleId, zone: value.zone, endTime: value.endTime }));
    }
}

/**
 * Marker placed on the chronologically earliest cycle of an irrigation
 * night. When set, `runOpen` emits `schedule-begun` after the cycle's
 * relay successfully opens.
 */
export type ScheduleStartMarker = {
    scheduleNight: string;
};

/**
 * Marker placed on the chronologically latest cycle of an irrigation
 * night. When set, `runClose` emits `schedule-ended` after the cycle's
 * relay successfully closes.
 */
export type ScheduleEndMarker = {
    scheduleNight: string;
    perZoneRuntimeMin: Record<string, number>;
    siteTimezone: string;
    nextIrrigation?: { zoneName: string; startTime: Date };
};

/**
 * Inputs to `armCycle` — external collaborators are injected so tests can
 * substitute deterministic stubs.
 */
export type ArmCycleInputs = {
    clock: Clock;
    registry: TimerRegistry;
    zone: Zone;
    cycle: PersistedCycle;
    openZone: (zone: Zone) => Promise<void>;
    closeZone: (zone: Zone) => Promise<void>;
    notifier: Notifier;
    alerter: Alerter;
    scheduleStart?: ScheduleStartMarker;
    scheduleEnd?: ScheduleEndMarker;
};

export function armCycle(inputs: ArmCycleInputs): void {
    const { clock, registry, cycle } = inputs;
    const openDelay = Math.max(0, cycle.startTime.getTime() - clock.now().getTime());

    let openHandle: TimerHandle;
    openHandle = clock.setTimeout(() => {
        registry.consumeOpen(openHandle);
        runOpen(inputs).catch(err => {
            console.error(`daemon: unhandled error in cycle open path for ${cycle.id}.`, err);
        });
    }, openDelay);
    registry.addOpen(openHandle);
}

async function runOpen(inputs: ArmCycleInputs): Promise<void> {
    const { clock, registry, zone, cycle, openZone, closeZone, notifier, alerter, scheduleStart, scheduleEnd } = inputs;

    try {
        await openZone(zone);
    } catch (err) {
        const reason = errorMessage(err);
        console.error(`daemon: openZone failed for cycle ${cycle.id} on zone ${zone.id}; leaving fired_at NULL.`, err);
        await alerter({
            class: 'ha-call-failed',
            tone: 'danger',
            title: 'HA open failed',
            sub: `Last attempt failed: ${reason}.`,
            zoneId: zone.id,
            zoneName: zone.name,
        });
        return;
    }

    const firedAt = clock.now();
    await getScheduleEntriesRepo().markCycleFired(cycle.id, firedAt);
    console.log(`daemon: opened zone ${zone.id} for cycle ${cycle.id} at ${firedAt.toISOString()}.`);

    if (scheduleStart) {
        console.log(`daemon: emitting schedule-begun for night ${scheduleStart.scheduleNight}.`);
        await notifier('schedule-begun', { scheduleNight: scheduleStart.scheduleNight });
    }

    const closeDelay = cycle.durationMin * 60_000;
    const endTime = new Date(firedAt.getTime() + closeDelay);
    const closeHandle = clock.setTimeout(() => {
        runClose({ clock, registry, zone, cycle, closeZone, notifier, alerter, scheduleEnd }).catch(err => {
            console.error(`daemon: unhandled error in cycle close path for ${cycle.id}.`, err);
        });
    }, closeDelay);
    registry.addInFlight(cycle.id, zone, closeHandle, endTime);
}

/**
 * Inputs to `armCloseOnly` — the boot-time reconciliation path that re-arms
 * a close timer for a cycle that was already running when the previous
 * daemon process died.
 */
export type ArmCloseOnlyInputs = {
    clock: Clock;
    registry: TimerRegistry;
    zone: Zone;
    cycle: PersistedCycle;
    closeZone: (zone: Zone) => Promise<void>;
    notifier: Notifier;
    alerter: Alerter;
    plannedCloseAt: Date;
};

export function armCloseOnly(inputs: ArmCloseOnlyInputs): void {
    const { clock, registry, zone, cycle, closeZone, notifier, alerter, plannedCloseAt } = inputs;
    const closeDelay = Math.max(0, plannedCloseAt.getTime() - clock.now().getTime());

    const closeHandle = clock.setTimeout(() => {
        runClose({ clock, registry, zone, cycle, closeZone, notifier, alerter }).catch(err => {
            console.error(`daemon: unhandled error in close-only path for cycle ${cycle.id}.`, err);
        });
    }, closeDelay);
    registry.addInFlight(cycle.id, zone, closeHandle, plannedCloseAt);
}

type RunCloseInputs = {
    clock: Clock;
    registry: TimerRegistry;
    zone: Zone;
    cycle: PersistedCycle;
    closeZone: (zone: Zone) => Promise<void>;
    notifier: Notifier;
    alerter: Alerter;
    scheduleEnd?: ScheduleEndMarker;
};

async function runClose(inputs: RunCloseInputs): Promise<void> {
    const { clock, registry, zone, cycle, closeZone, notifier, alerter, scheduleEnd } = inputs;

    try {
        await closeZone(zone);
    } catch (err) {
        const reason = errorMessage(err);
        console.error(`daemon: closeZone failed for cycle ${cycle.id} on zone ${zone.id}; leaving closed_at NULL.`, err);
        registry.clearInFlight(cycle.id);
        await alerter({
            class: 'ha-call-failed',
            tone: 'danger',
            title: 'HA close failed',
            sub: `Last attempt failed: ${reason}.`,
            zoneId: zone.id,
            zoneName: zone.name,
        });
        return;
    }

    const closedAt = clock.now();
    await getScheduleEntriesRepo().markCycleClosed(cycle.id, closedAt);
    await getZonesRepo().advanceDepletion(zone.id, 0, closedAt);
    registry.clearInFlight(cycle.id);
    console.log(`daemon: closed zone ${zone.id} for cycle ${cycle.id} at ${closedAt.toISOString()}.`);

    if (scheduleEnd) {
        console.log(`daemon: emitting schedule-ended for night ${scheduleEnd.scheduleNight}.`);
        await notifier('schedule-ended', {
            scheduleNight: scheduleEnd.scheduleNight,
            perZoneRuntimeMin: scheduleEnd.perZoneRuntimeMin,
            siteTimezone: scheduleEnd.siteTimezone,
            ...(scheduleEnd.nextIrrigation ? { nextIrrigation: scheduleEnd.nextIrrigation } : {}),
        });
    }
}

/**
 * Closes every relay the daemon currently has marked in-flight. Used by
 * `shutdown`. Caller must have cancelled the close timers via
 * `registry.cancelAllTimers` first; this function only does the close + DB
 * update side. Tolerates `closeZone` failures (logs and continues).
 */
export async function closeAllInFlight(inputs: {
    clock: Clock;
    registry: TimerRegistry;
    closeZone: (zone: Zone) => Promise<void>;
    alerter: Alerter;
}): Promise<void> {
    const { clock, registry, closeZone, alerter } = inputs;
    const inFlight = registry.snapshotInFlight();

    if (inFlight.length === 0) return;
    console.log(`daemon: closing ${inFlight.length} in-flight relay(s) on shutdown.`);

    for (const { cycleId, zone } of inFlight) {
        try {
            await closeZone(zone);
            await getScheduleEntriesRepo().markCycleClosed(cycleId, clock.now());
        } catch (err) {
            const reason = errorMessage(err);
            console.error(`daemon: shutdown closeZone failed for cycle ${cycleId} on zone ${zone.id}.`, err);
            await alerter({
                class: 'ha-call-failed',
                tone: 'danger',
                title: 'HA close failed during shutdown',
                sub: `Last attempt failed: ${reason}.`,
                zoneId: zone.id,
                zoneName: zone.name,
            });
        }
        registry.clearInFlight(cycleId);
    }
}

function errorMessage(err: unknown): string {
    if (err instanceof Error) return err.message;
    return String(err);
}
