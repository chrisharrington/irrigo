import { eq } from 'drizzle-orm';
import { irrigationCycles } from '@/db/schema';
import type { Zone } from '@/models';
import type { Notifier } from '@/notifications';
import type { PersistedCycle } from './schedules';

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
 * the right order on `rePlan` and `shutdown`. Two slots:
 *
 * - `openHandles`: setTimeout handles for cycles whose open hasn't fired yet.
 * - `inFlight`: cycles whose open succeeded but whose close timer is still
 *   pending — they have an active relay in HA.
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

    /**
     * Cancels every pending open timer. Leaves in-flight cycles alone so a
     * watering cycle that's already running can finish before the new plan
     * takes over.
     */
    cancelOpenTimers(clock: Clock): void {
        for (const handle of this.openHandles) clock.clearTimeout(handle);
        this.openHandles.clear();
    }

    /**
     * Cancels every timer the daemon owns: open, close, and the next-re-plan
     * timer. Used by `shutdown`. The caller is responsible for closing any
     * in-flight relays before clearing them from the registry.
     */
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
 * Minimal db interface for cycle-row updates. Mirrors Drizzle's
 * `update().set().where()` chain.
 */
export type RuntimeDb = {
    update: (table: typeof irrigationCycles) => {
        set: (values: Record<string, unknown>) => {
            where: (cond: unknown) => Promise<unknown>;
        };
    };
};

/**
 * Marker placed on the chronologically earliest cycle of an irrigation
 * night. When set, `runOpen` emits `schedule-begun` after the cycle's
 * relay successfully opens.
 */
export type ScheduleStartMarker = {
    /** Irrigation night this cycle opens (YYYY-MM-DD, site timezone). */
    scheduleNight: string;
};

/**
 * Marker placed on the chronologically latest cycle of an irrigation
 * night. When set, `runClose` emits `schedule-ended` after the cycle's
 * relay successfully closes, carrying the per-zone runtime summary and a
 * pointer to the next night's first cycle (if any).
 */
export type ScheduleEndMarker = {
    /** Irrigation night this cycle ends (YYYY-MM-DD, site timezone). */
    scheduleNight: string;
    /** Total minutes watered per zone for the night, keyed by zone display name. */
    perZoneRuntimeMin: Record<string, number>;
    /** Site timezone used to format `nextIrrigation` for the operator. */
    siteTimezone: string;
    /** Earliest cycle of the next night, when one was produced by the same re-plan. */
    nextIrrigation?: { zoneName: string; startTime: Date };
};

/**
 * Inputs to `armCycle` — every external collaborator is injected so tests can
 * substitute deterministic stubs.
 */
export type ArmCycleInputs = {
    db: RuntimeDb;
    clock: Clock;
    registry: TimerRegistry;
    zone: Zone;
    cycle: PersistedCycle;
    openZone: (zone: Zone) => Promise<void>;
    closeZone: (zone: Zone) => Promise<void>;
    notifier: Notifier;

    /**
     * Set on the chronologically earliest armed cycle of an irrigation
     * night so `runOpen` can emit the night's `schedule-begun` notification.
     * Boot-recovery arms leave it undefined — the begun notification, if
     * applicable, was already emitted by the prior process.
     */
    scheduleStart?: ScheduleStartMarker;

    /**
     * Set on the chronologically latest armed cycle of an irrigation night
     * so `runClose` can emit the night's `schedule-ended` notification with
     * the per-zone summary. Boot-recovery arms leave it undefined.
     */
    scheduleEnd?: ScheduleEndMarker;
};

/**
 * Schedules the open-then-close lifecycle for a single irrigation cycle.
 * Records `fired_at` after a successful open; chains a close timer for
 * `durationMin * 60_000` ms; records `closed_at` after a successful close.
 * Failures at either step log to console.error and leave the corresponding
 * column NULL — the daemon never re-fires a failed cycle.
 *
 * @param inputs - Collaborators and the cycle/zone being armed.
 */
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
    const { db, clock, registry, zone, cycle, openZone, closeZone, notifier, scheduleStart, scheduleEnd } = inputs;

    try {
        await openZone(zone);
    } catch (err) {
        console.error(`daemon: openZone failed for cycle ${cycle.id} on zone ${zone.id}; leaving fired_at NULL.`, err);
        await notifier('error', { zoneName: zone.name, operation: 'open', reason: errorMessage(err) });
        return;
    }

    const firedAt = clock.now();
    await db.update(irrigationCycles).set({ firedAt }).where(eq(irrigationCycles.id, cycle.id));
    console.log(`daemon: opened zone ${zone.id} for cycle ${cycle.id} at ${firedAt.toISOString()}.`);

    if (scheduleStart) {
        console.log(`daemon: emitting schedule-begun for night ${scheduleStart.scheduleNight}.`);
        await notifier('schedule-begun', { scheduleNight: scheduleStart.scheduleNight });
    }

    const closeDelay = cycle.durationMin * 60_000;
    const endTime = new Date(firedAt.getTime() + closeDelay);
    const closeHandle = clock.setTimeout(() => {
        runClose({ db, clock, registry, zone, cycle, closeZone, notifier, scheduleEnd }).catch(err => {
            console.error(`daemon: unhandled error in cycle close path for ${cycle.id}.`, err);
        });
    }, closeDelay);
    registry.addInFlight(cycle.id, zone, closeHandle, endTime);
}

/**
 * Inputs to `armCloseOnly` — the boot-time reconciliation path that
 * re-arms a close timer for a cycle that was already running when the
 * previous daemon process died. There is no open phase: HA already has
 * the relay energised, the DB already has `firedAt`, and we just need to
 * land the close at the planned time (or immediately if it's past).
 */
export type ArmCloseOnlyInputs = {
    db: RuntimeDb;
    clock: Clock;
    registry: TimerRegistry;
    zone: Zone;
    cycle: PersistedCycle;
    closeZone: (zone: Zone) => Promise<void>;
    notifier: Notifier;

    /** Wall-clock time at which the close should fire. Past times fire immediately. */
    plannedCloseAt: Date;
};

/**
 * Schedules the close half of a cycle's lifecycle without re-running the
 * open. Pre-registers the cycle as in-flight so `getStatus().activeZones`
 * reflects the resumed zone before the timer fires; the close path itself
 * reuses `runClose` so success/failure semantics match a normally-armed
 * cycle exactly.
 *
 * @param inputs - Collaborators and the cycle/zone whose close is being re-armed.
 */
export function armCloseOnly(inputs: ArmCloseOnlyInputs): void {
    const { db, clock, registry, zone, cycle, closeZone, notifier, plannedCloseAt } = inputs;
    const closeDelay = Math.max(0, plannedCloseAt.getTime() - clock.now().getTime());

    const closeHandle = clock.setTimeout(() => {
        runClose({ db, clock, registry, zone, cycle, closeZone, notifier }).catch(err => {
            console.error(`daemon: unhandled error in close-only path for cycle ${cycle.id}.`, err);
        });
    }, closeDelay);
    registry.addInFlight(cycle.id, zone, closeHandle, plannedCloseAt);
}

type RunCloseInputs = {
    db: RuntimeDb;
    clock: Clock;
    registry: TimerRegistry;
    zone: Zone;
    cycle: PersistedCycle;
    closeZone: (zone: Zone) => Promise<void>;
    notifier: Notifier;
    /** Set on the last cycle of an irrigation night so close emits `schedule-ended`. */
    scheduleEnd?: ScheduleEndMarker;
};

async function runClose(inputs: RunCloseInputs): Promise<void> {
    const { db, clock, registry, zone, cycle, closeZone, notifier, scheduleEnd } = inputs;

    try {
        await closeZone(zone);
    } catch (err) {
        console.error(`daemon: closeZone failed for cycle ${cycle.id} on zone ${zone.id}; leaving closed_at NULL.`, err);
        registry.clearInFlight(cycle.id);
        await notifier('error', { zoneName: zone.name, operation: 'close', reason: errorMessage(err) });
        return;
    }

    const closedAt = clock.now();
    await db.update(irrigationCycles).set({ closedAt }).where(eq(irrigationCycles.id, cycle.id));
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
    db: RuntimeDb;
    clock: Clock;
    registry: TimerRegistry;
    closeZone: (zone: Zone) => Promise<void>;
    notifier: Notifier;
}): Promise<void> {
    const { db, clock, registry, closeZone, notifier } = inputs;
    const inFlight = registry.snapshotInFlight();

    if (inFlight.length === 0) return;
    console.log(`daemon: closing ${inFlight.length} in-flight relay(s) on shutdown.`);

    for (const { cycleId, zone } of inFlight) {
        try {
            await closeZone(zone);
            await db.update(irrigationCycles).set({ closedAt: clock.now() }).where(eq(irrigationCycles.id, cycleId));
        } catch (err) {
            console.error(`daemon: shutdown closeZone failed for cycle ${cycleId} on zone ${zone.id}.`, err);
            await notifier('error', { zoneName: zone.name, operation: 'shutdown-close', reason: errorMessage(err) });
        }
        registry.clearInFlight(cycleId);
    }
}

function errorMessage(err: unknown): string {
    if (err instanceof Error) return err.message;
    return String(err);
}
