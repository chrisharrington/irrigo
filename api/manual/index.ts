import dayjs from 'dayjs';
import { eq } from 'drizzle-orm';
import { irrigationCycles, scheduleEntries, zones } from '@/db/schema';
import type { Clock, TimerHandle } from '@/daemon/runtime';
import type { Zone } from '@/models';
import type { Notifier } from '@/notifications';

/**
 * Hard cap on `/run` duration. Manual fires are for testing and one-off
 * "water now" use cases — anything longer should be a planned cycle.
 */
export const MAX_RUN_DURATION_MIN = 60;

/**
 * Sentinel error thrown by `open` and `run` when the controller refuses
 * because something else is currently watering. The HTTP layer maps this
 * to a 409.
 */
export class BusyError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'BusyError';
    }
}

/**
 * Minimal db interface needed by the manual controller. Mirrors the chained
 * Drizzle `insert/update` shapes the recording test stub already supports.
 */
export type ManualControllerDb = {
    insert: (table: typeof scheduleEntries | typeof irrigationCycles) => {
        values: (rows: ReadonlyArray<Record<string, unknown>>) => {
            returning: (cols: Record<string, unknown>) => Promise<Array<Record<string, unknown>>>;
        };
    };
    update: (table: typeof zones | typeof irrigationCycles) => {
        set: (values: Record<string, unknown>) => {
            where: (cond: unknown) => Promise<unknown>;
        };
    };
};

/**
 * Collaborators injected at construction time so tests can substitute
 * deterministic stubs.
 */
export type ManualControllerDeps = {
    db: ManualControllerDb;
    clock: Clock;
    openZone: (zone: Zone) => Promise<void>;
    closeZone: (zone: Zone) => Promise<void>;
    notifier: Notifier;

    /**
     * Returns true if a scheduled cycle is currently in-flight. The controller
     * uses this to refuse manual fires while the daemon owns the relay.
     */
    isAnyScheduledInFlight: () => boolean;
};

export type ActiveManualSnapshot = {
    zoneId: string;
    zoneName: string;
    since: Date;
};

/**
 * Public surface of the manual fire controller. Wired into HTTP routes.
 */
export type ManualController = {
    /** Opens the zone's relay. Returns when HA acknowledges the turn_on. */
    open: (zone: Zone) => Promise<{ since: Date }>;

    /**
     * Closes the zone's relay. Idempotent: if the controller has no record
     * of this zone being open, it still issues HA's `turn_off` (which is
     * itself idempotent) and returns success.
     */
    close: (zone: Zone) => Promise<{ closed: boolean }>;

    /**
     * Opens the relay and schedules an automatic close after `durationMin`
     * minutes. Equivalent to `open` followed by a deferred `close`, but
     * records the planned duration in the irrigation_cycles row up front.
     */
    run: (zone: Zone, durationMin: number) => Promise<{ since: Date; willCloseAt: Date }>;

    /** Snapshot of the active manual fire (if any). Drives the HTTP status. */
    getActiveZone: () => ActiveManualSnapshot | null;

    /** Closes the open relay (best-effort) and cancels any pending close timer. */
    shutdown: () => Promise<void>;
};

type ActiveManualFire = {
    zone: Zone;
    openedAt: Date;
    closeHandle?: TimerHandle;
    cycleId?: string;
    runDurationMin?: number;
};

/**
 * Builds a manual fire controller. The controller is a small in-process
 * single-slot lock plus the side effects required to keep zone state and
 * irrigation history coherent: it calls HA's open/close primitives, writes
 * matching `schedule_entries` (`source = 'manual'`) and `irrigation_cycles`
 * rows, and updates `zones.current_depletion_mm` so the planner's next
 * re-plan starts from the post-fire soil-moisture state.
 *
 * @param deps - Collaborators and config.
 * @returns Wired controller ready to back the `/zones/:id/...` routes.
 */
export function createManualController(deps: ManualControllerDeps): ManualController {
    const { db, clock, openZone, closeZone, notifier, isAnyScheduledInFlight } = deps;
    let current: ActiveManualFire | null = null;

    const ensureFree = (action: string, zone: Zone): void => {
        if (current !== null) {
            throw new BusyError(`manual: cannot ${action} zone ${zone.id} — manual fire already active for zone ${current.zone.id}.`);
        }
        if (isAnyScheduledInFlight()) {
            throw new BusyError(`manual: cannot ${action} zone ${zone.id} — a scheduled cycle is currently in flight.`);
        }
    };

    const writeManualRecord = async (
        zone: Zone,
        openedAt: Date,
        closedAt: Date | null,
        durationMin: number,
    ): Promise<string | null> => {
        const today = dayjs(openedAt).format('YYYY-MM-DD');
        const precipRate = zone.precipitationRateMmPerHr ?? (60 * (zone.flowRateLPerMin / zone.areaM2));
        const appliedDepth = (durationMin / 60) * precipRate;
        const netDepth = appliedDepth * zone.irrigationEfficiency;
        const depletionBefore = zone.currentDepletionMm;
        const depletionAfter = Math.max(0, depletionBefore - netDepth);

        const insertedEntry = await db
            .insert(scheduleEntries)
            .values([
                {
                    zoneId: zone.id,
                    scheduleId: null,
                    date: today,
                    appliedDepthMm: roundTo1Decimal(appliedDepth),
                    depletionBeforeMm: roundTo1Decimal(depletionBefore),
                    depletionAfterMm: roundTo1Decimal(depletionAfter),
                    source: 'manual',
                },
            ])
            .returning({ id: scheduleEntries.id });

        const entryId = (insertedEntry[0] as { id: string } | undefined)?.id;
        if (!entryId) {
            console.warn(`manual: schedule_entries insert returned no id for zone ${zone.id}; skipping cycle row.`);
            return null;
        }

        const insertedCycle = await db
            .insert(irrigationCycles)
            .values([
                {
                    scheduleEntryId: entryId,
                    startTime: openedAt,
                    durationMin,
                    firedAt: openedAt,
                    closedAt,
                },
            ])
            .returning({ id: irrigationCycles.id });

        const cycleId = (insertedCycle[0] as { id: string } | undefined)?.id ?? null;

        await db
            .update(zones)
            .set({ currentDepletionMm: depletionAfter })
            .where(eq(zones.id, zone.id));

        return cycleId;
    };

    const updateCycleClosedAt = async (cycleId: string, closedAt: Date): Promise<void> => {
        await db
            .update(irrigationCycles)
            .set({ closedAt })
            .where(eq(irrigationCycles.id, cycleId));
    };

    const open: ManualController['open'] = async (zone) => {
        ensureFree('open', zone);

        try {
            await openZone(zone);
        } catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            console.error(`manual: openZone failed for zone ${zone.id}.`, err);
            await notifier('error', { zoneName: zone.name, operation: 'open', reason });
            throw err;
        }

        const openedAt = clock.now();
        current = { zone, openedAt };
        console.log(`manual: opened zone ${zone.id} at ${openedAt.toISOString()}.`);
        await notifier('watering-started', { zoneName: zone.name, reason: 'manual' });

        return { since: openedAt };
    };

    const close: ManualController['close'] = async (zone) => {
        const active = current?.zone.id === zone.id ? current : null;

        if (active === null) {
            try {
                await closeZone(zone);
            } catch (err) {
                const reason = err instanceof Error ? err.message : String(err);
                console.error(`manual: defensive closeZone failed for zone ${zone.id}.`, err);
                await notifier('error', { zoneName: zone.name, operation: 'close', reason });
                throw err;
            }
            console.log(`manual: defensive close for zone ${zone.id} (no active manual fire).`);
            return { closed: true };
        }

        if (active.closeHandle !== undefined) {
            clock.clearTimeout(active.closeHandle);
        }
        const { openedAt, cycleId, runDurationMin } = active;
        current = null;

        try {
            await closeZone(zone);
        } catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            console.error(`manual: closeZone failed for zone ${zone.id}.`, err);
            await notifier('error', { zoneName: zone.name, operation: 'close', reason });
            throw err;
        }

        const closedAt = clock.now();

        if (runDurationMin !== undefined && cycleId !== undefined) {
            await updateCycleClosedAt(cycleId, closedAt);
        } else {
            const elapsedMin = (closedAt.getTime() - openedAt.getTime()) / 60_000;
            await writeManualRecord(zone, openedAt, closedAt, elapsedMin);
        }

        console.log(`manual: closed zone ${zone.id} at ${closedAt.toISOString()}.`);
        await notifier('watering-ended', { zoneName: zone.name, reason: 'manual' });
        return { closed: true };
    };

    const onScheduledCloseFire = async (zone: Zone, cycleId: string | null): Promise<void> => {
        if (current?.zone.id !== zone.id) return;
        current = null;

        try {
            await closeZone(zone);
        } catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            console.error(`manual: scheduled close failed for zone ${zone.id}.`, err);
            await notifier('error', { zoneName: zone.name, operation: 'close', reason });
            return;
        }

        const closedAt = clock.now();
        if (cycleId !== null) {
            await updateCycleClosedAt(cycleId, closedAt);
        }

        console.log(`manual: scheduled close for zone ${zone.id} at ${closedAt.toISOString()}.`);
        await notifier('watering-ended', { zoneName: zone.name, reason: 'manual' });
    };

    const run: ManualController['run'] = async (zone, durationMin) => {
        if (!Number.isFinite(durationMin) || durationMin <= 0) {
            throw new Error(`manual: durationMin must be > 0 (got ${durationMin}).`);
        }
        if (durationMin > MAX_RUN_DURATION_MIN) {
            throw new Error(`manual: durationMin ${durationMin} exceeds maximum ${MAX_RUN_DURATION_MIN}.`);
        }
        ensureFree('run', zone);

        try {
            await openZone(zone);
        } catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            console.error(`manual: openZone failed for zone ${zone.id}.`, err);
            await notifier('error', { zoneName: zone.name, operation: 'open', reason });
            throw err;
        }

        const openedAt = clock.now();
        const willCloseAt = new Date(openedAt.getTime() + durationMin * 60_000);
        const cycleId = await writeManualRecord(zone, openedAt, null, durationMin);

        const closeHandle = clock.setTimeout(() => {
            onScheduledCloseFire(zone, cycleId).catch(err => {
                console.error(`manual: unhandled error in scheduled close path for zone ${zone.id}.`, err);
            });
        }, durationMin * 60_000);

        current = { zone, openedAt, closeHandle, cycleId: cycleId ?? undefined, runDurationMin: durationMin };
        console.log(`manual: opened zone ${zone.id} at ${openedAt.toISOString()} for ${durationMin} min (auto-close).`);
        await notifier('watering-started', { zoneName: zone.name, durationMin, reason: 'manual' });

        return { since: openedAt, willCloseAt };
    };

    const getActiveZone: ManualController['getActiveZone'] = () => {
        if (current === null) return null;
        return { zoneId: current.zone.id, zoneName: current.zone.name, since: current.openedAt };
    };

    const shutdown: ManualController['shutdown'] = async () => {
        if (current === null) return;
        const active = current;
        current = null;

        if (active.closeHandle !== undefined) {
            clock.clearTimeout(active.closeHandle);
        }

        try {
            await closeZone(active.zone);
            const closedAt = clock.now();
            console.log(`manual: closed zone ${active.zone.id} on shutdown.`);
            if (active.cycleId !== undefined) {
                await updateCycleClosedAt(active.cycleId, closedAt);
            }
            await notifier('watering-ended', { zoneName: active.zone.name, reason: 'shutdown' });
        } catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            console.error(`manual: shutdown closeZone failed for zone ${active.zone.id}.`, err);
            await notifier('error', { zoneName: active.zone.name, operation: 'shutdown-close', reason });
        }
    };

    return { open, close, run, getActiveZone, shutdown };
}

function roundTo1Decimal(value: number): number {
    return Math.round(value * 10) / 10;
}
