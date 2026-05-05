import { eq } from 'drizzle-orm';
import { irrigationCycles } from '@/db/schema';
import type { Zone } from '@/models';
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
    private readonly inFlight = new Map<string, { zone: Zone; closeHandle: TimerHandle }>();
    private rePlanHandle: TimerHandle | undefined;

    addOpen(handle: TimerHandle): void {
        this.openHandles.add(handle);
    }

    consumeOpen(handle: TimerHandle): void {
        this.openHandles.delete(handle);
    }

    addInFlight(cycleId: string, zone: Zone, closeHandle: TimerHandle): void {
        this.inFlight.set(cycleId, { zone, closeHandle });
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

    snapshotInFlight(): ReadonlyArray<{ cycleId: string; zone: Zone }> {
        return [...this.inFlight.entries()].map(([cycleId, value]) => ({ cycleId, zone: value.zone }));
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
    const { db, clock, registry, zone, cycle, openZone, closeZone } = inputs;

    try {
        await openZone(zone);
    } catch (err) {
        console.error(`daemon: openZone failed for cycle ${cycle.id} on zone ${zone.id}; leaving fired_at NULL.`, err);
        return;
    }

    const firedAt = clock.now();
    await db.update(irrigationCycles).set({ firedAt }).where(eq(irrigationCycles.id, cycle.id));
    console.log(`daemon: opened zone ${zone.id} for cycle ${cycle.id} at ${firedAt.toISOString()}.`);

    const closeDelay = cycle.durationMin * 60_000;
    const closeHandle = clock.setTimeout(() => {
        runClose({ db, clock, registry, zone, cycle, closeZone }).catch(err => {
            console.error(`daemon: unhandled error in cycle close path for ${cycle.id}.`, err);
        });
    }, closeDelay);
    registry.addInFlight(cycle.id, zone, closeHandle);
}

type RunCloseInputs = {
    db: RuntimeDb;
    clock: Clock;
    registry: TimerRegistry;
    zone: Zone;
    cycle: PersistedCycle;
    closeZone: (zone: Zone) => Promise<void>;
};

async function runClose(inputs: RunCloseInputs): Promise<void> {
    const { db, clock, registry, zone, cycle, closeZone } = inputs;

    try {
        await closeZone(zone);
    } catch (err) {
        console.error(`daemon: closeZone failed for cycle ${cycle.id} on zone ${zone.id}; leaving closed_at NULL.`, err);
        registry.clearInFlight(cycle.id);
        return;
    }

    const closedAt = clock.now();
    await db.update(irrigationCycles).set({ closedAt }).where(eq(irrigationCycles.id, cycle.id));
    registry.clearInFlight(cycle.id);
    console.log(`daemon: closed zone ${zone.id} for cycle ${cycle.id} at ${closedAt.toISOString()}.`);
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
}): Promise<void> {
    const { db, clock, registry, closeZone } = inputs;
    const inFlight = registry.snapshotInFlight();

    if (inFlight.length === 0) return;
    console.log(`daemon: closing ${inFlight.length} in-flight relay(s) on shutdown.`);

    for (const { cycleId, zone } of inFlight) {
        try {
            await closeZone(zone);
            await db.update(irrigationCycles).set({ closedAt: clock.now() }).where(eq(irrigationCycles.id, cycleId));
        } catch (err) {
            console.error(`daemon: shutdown closeZone failed for cycle ${cycleId} on zone ${zone.id}.`, err);
        }
        registry.clearInFlight(cycleId);
    }
}
