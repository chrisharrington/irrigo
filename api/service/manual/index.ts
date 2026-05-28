import type { Database } from '@/db';
import type { ActiveManualSnapshot, ManualController, ManualControllerDeps } from '@/models/manual';
import type { Zone } from '@/models';
import { createManualRepository, type ManualRepository } from '@/repositories/manual';
import type { TimerHandle } from '@/service/daemon/runtime';

export type { ActiveManualSnapshot, ManualController, ManualControllerDeps } from '@/models/manual';

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
 * Sentinel error thrown by `open` and `run` when the master irrigation kill
 * switch is off. The HTTP layer maps this to a 409 with
 * `error: 'system-disabled'`.
 */
export class SystemDisabledError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'SystemDisabledError';
    }
}

/**
 * Input to `bootManualService`. Production passes `{ db }`; tests pass
 * `{ repo }` with an object-literal fake.
 */
export type BootManualServiceInput =
    | { db: Database }
    | { repo: ManualRepository };

let repo: ManualRepository | null = null;

/**
 * Wires the manual service to its repository. Call once at process boot
 * before `createManualController(...)`; call again in test `beforeEach` with
 * a fake to isolate behavior.
 */
export function bootManualService(input: BootManualServiceInput): void {
    repo = 'repo' in input ? input.repo : createManualRepository(input.db);
}

function getRepo(): ManualRepository {
    if (!repo) {
        throw new Error('Manual service not booted — call bootManualService({ db }) at startup.');
    }
    return repo;
}

type ActiveManualFire = {
    zone: Zone;
    openedAt: Date;
    willCloseAt: Date | null;
    closeHandle?: TimerHandle;
    cycleId?: string;
    runDurationMin?: number;
};

/**
 * Builds a manual fire controller. The controller is a small in-process
 * single-slot lock plus the side effects required to keep zone state and
 * irrigation history coherent: it calls HA's open/close primitives, writes
 * matching `schedule_entries` (`source = 'manual'`) and `irrigation_cycles`
 * rows via the repository, and updates `zones.current_depletion_mm` so the
 * planner's next re-plan starts from the post-fire soil-moisture state.
 *
 * Closure-held state (`current`, close timer, cycle id) lives on the
 * service tier; the repository handles only persistence.
 */
export function createManualController(deps: ManualControllerDeps): ManualController {
    const { clock, openZone, closeZone, notifier, isAnyScheduledInFlight, isIrrigationEnabled } = deps;
    let current: ActiveManualFire | null = null;

    const ensureSystemEnabled = async (action: string, zone: Zone): Promise<void> => {
        if (!(await isIrrigationEnabled())) {
            throw new SystemDisabledError(`manual: cannot ${action} zone ${zone.id} — irrigation is disabled.`);
        }
    };

    const ensureFree = (action: string, zone: Zone): void => {
        if (current !== null) {
            throw new BusyError(`manual: cannot ${action} zone ${zone.id} — manual fire already active for zone ${current.zone.id}.`);
        }
        if (isAnyScheduledInFlight()) {
            throw new BusyError(`manual: cannot ${action} zone ${zone.id} — a scheduled cycle is currently in flight.`);
        }
    };

    const open: ManualController['open'] = async (zone) => {
        await ensureSystemEnabled('open', zone);
        ensureFree('open', zone);

        try {
            await openZone(zone);
        } catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            console.error(`manual: openZone failed for zone ${zone.id}.`, err);
            await notifier('error', { zoneName: zone.name, errorTitle: 'Manual open failed', errorSub: `Last attempt failed: ${reason}.` });
            throw err;
        }

        const openedAt = clock.now();
        current = { zone, openedAt, willCloseAt: null };
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
                await notifier('error', { zoneName: zone.name, errorTitle: 'Manual close failed', errorSub: `Last attempt failed: ${reason}.` });
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
            await notifier('error', { zoneName: zone.name, errorTitle: 'Manual close failed', errorSub: `Last attempt failed: ${reason}.` });
            throw err;
        }

        const closedAt = clock.now();

        if (runDurationMin !== undefined && cycleId !== undefined) {
            await getRepo().updateCycleClosedAt(cycleId, closedAt);
        } else {
            const elapsedMin = (closedAt.getTime() - openedAt.getTime()) / 60_000;
            await getRepo().writeManualRecord(zone, openedAt, closedAt, elapsedMin);
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
            await notifier('error', { zoneName: zone.name, errorTitle: 'Manual close failed', errorSub: `Last attempt failed: ${reason}.` });
            return;
        }

        const closedAt = clock.now();
        if (cycleId !== null) {
            await getRepo().updateCycleClosedAt(cycleId, closedAt);
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
        await ensureSystemEnabled('run', zone);
        ensureFree('run', zone);

        try {
            await openZone(zone);
        } catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            console.error(`manual: openZone failed for zone ${zone.id}.`, err);
            await notifier('error', { zoneName: zone.name, errorTitle: 'Manual run open failed', errorSub: `Last attempt failed: ${reason}.` });
            throw err;
        }

        const openedAt = clock.now();
        const willCloseAt = new Date(openedAt.getTime() + durationMin * 60_000);
        const cycleId = await getRepo().writeManualRecord(zone, openedAt, null, durationMin);

        const closeHandle = clock.setTimeout(() => {
            onScheduledCloseFire(zone, cycleId).catch(err => {
                console.error(`manual: unhandled error in scheduled close path for zone ${zone.id}.`, err);
            });
        }, durationMin * 60_000);

        current = { zone, openedAt, willCloseAt, closeHandle, cycleId: cycleId ?? undefined, runDurationMin: durationMin };
        console.log(`manual: opened zone ${zone.id} at ${openedAt.toISOString()} for ${durationMin} min (auto-close).`);
        await notifier('watering-started', { zoneName: zone.name, durationMin, reason: 'manual' });

        return { since: openedAt, willCloseAt };
    };

    const getActiveZone: ManualController['getActiveZone'] = () => {
        if (current === null) return null;
        return {
            zoneId: current.zone.id,
            zoneName: current.zone.name,
            since: current.openedAt,
            willCloseAt: current.willCloseAt,
        };
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
                await getRepo().updateCycleClosedAt(active.cycleId, closedAt);
            }
            await notifier('watering-ended', { zoneName: active.zone.name, reason: 'shutdown' });
        } catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            console.error(`manual: shutdown closeZone failed for zone ${active.zone.id}.`, err);
            await notifier('error', { zoneName: active.zone.name, errorTitle: 'Shutdown close failed', errorSub: `Last attempt failed: ${reason}.` });
        }
    };

    return { open, close, run, getActiveZone, shutdown };
}
