import { eq } from 'drizzle-orm';
import type { AlertRecorder } from '@/alerts';
import { irrigationCycles } from '@/db/schema';
import type { ZoneRelayState } from '@/data/home-assistant';
import type { Zone } from '@/models';
import type { Notifier } from '@/notifications';
import type { FutureCyclePair, FutureCyclesDb } from './schedules';
import type { ArmCloseOnlyInputs, Clock, RuntimeDb, TimerRegistry } from './runtime';

/**
 * Counters from a reconciliation pass. The daemon logs these in a single
 * summary line at startup so operators can tell at a glance whether the
 * previous shutdown left state behind that needed cleanup.
 */
export type ReconcileSummary = {
    /** In-flight cycles whose close was successfully re-armed for the planned time. */
    resumed: number;
    /** In-flight cycles HA still had open past their planned close — closed immediately. */
    forcedClosed: number;
    /** In-flight cycles HA had already closed — `closed_at` recorded after the fact. */
    missedClose: number;
    /** Managed zones HA had open with no in-flight cycle backing them — force-closed. */
    orphansClosed: number;
    /** HA state queries (or close calls) that errored — those zones were skipped. */
    errors: number;
};

/**
 * Db surface needed by the reconciler. The reconciler only updates the
 * `irrigation_cycles` row's `closed_at`; it never inserts.
 */
export type ReconcileDb = FutureCyclesDb & RuntimeDb;

/**
 * Collaborators injected at construction. Everything external is replaceable
 * so the orchestrator is fully testable without touching HA, the DB, or the
 * real clock.
 */
export type ReconcileDeps = {
    db: ReconcileDb;
    clock: Clock;
    registry: TimerRegistry;
    notifier: Notifier;
    alertRecorder: AlertRecorder;
    closeZone: (zone: Zone) => Promise<void>;
    getZoneState: (zone: Zone) => Promise<ZoneRelayState>;
    loadInFlightCycles: (db: ReconcileDb, now: Date) => Promise<FutureCyclePair[]>;
    armCloseOnly: (inputs: ArmCloseOnlyInputs) => void;

    /**
     * Managed zones for the defensive sweep. Caller (the daemon's `start`)
     * supplies enabled zones with non-null `homeAssistantEntityId`.
     */
    managedZones: ReadonlyArray<Zone>;
};

/**
 * Resumes or closes any cycle that was in-flight at the previous shutdown,
 * then defensively force-closes any managed zone that's open with no
 * in-flight cycle backing it. Runs **before** the daemon arms timers for
 * future cycles.
 *
 * Failures of individual zones are tolerated and counted as `errors` —
 * reconciliation should make as much progress as it can rather than abort
 * the whole boot. The caller decides whether to surface a non-zero error
 * count.
 *
 * @param deps - Collaborators and the managed-zone list.
 * @returns Counters describing what changed.
 */
export async function reconcileCycleAndRelayState(deps: ReconcileDeps): Promise<ReconcileSummary> {
    const { db, clock, registry, notifier, alertRecorder, closeZone, getZoneState, loadInFlightCycles, armCloseOnly, managedZones } = deps;

    const summary: ReconcileSummary = { resumed: 0, forcedClosed: 0, missedClose: 0, orphansClosed: 0, errors: 0 };
    const handledZoneIds = new Set<string>();

    const inFlight = await loadInFlightCycles(db, clock.now());

    for (const { cycle, zone } of inFlight) {
        const plannedCloseAt = new Date(cycle.startTime.getTime() + cycle.durationMin * 60_000);
        const now = clock.now();

        let state: ZoneRelayState;
        try {
            state = await getZoneState(zone);
        } catch (err) {
            const reason = errorMessage(err);
            console.error(`daemon: reconcile getZoneState failed for cycle ${cycle.id} on zone ${zone.id}; skipping.`, err);
            await notifier('error', { zoneName: zone.name, operation: 'reconcile-state', reason });
            await alertRecorder({
                class: 'ha-call-failed',
                tone: 'danger',
                title: 'HA state query failed',
                sub: `${zone.name} · ${reason}`,
                zoneId: zone.id,
            });
            summary.errors += 1;
            continue;
        }

        if (state === 'unknown') {
            console.warn(`daemon: reconcile got unknown state for cycle ${cycle.id} on zone ${zone.id}; leaving cycle untouched.`);
            continue;
        }

        if (state === 'on' && plannedCloseAt.getTime() > now.getTime()) {
            armCloseOnly({ db, clock, registry, zone, cycle, closeZone, notifier, alertRecorder, plannedCloseAt });
            handledZoneIds.add(zone.id);
            summary.resumed += 1;
            console.log(`daemon: reconcile resumed cycle ${cycle.id} on zone ${zone.id} (closes at ${plannedCloseAt.toISOString()}).`);
            continue;
        }

        if (state === 'on') {
            try {
                await closeZone(zone);
            } catch (err) {
                const reason = errorMessage(err);
                console.error(`daemon: reconcile force-close failed for cycle ${cycle.id} on zone ${zone.id}.`, err);
                await notifier('error', { zoneName: zone.name, operation: 'reconcile-overrun-close', reason });
                await alertRecorder({
                    class: 'ha-call-failed',
                    tone: 'danger',
                    title: 'HA close failed (reconcile)',
                    sub: `${zone.name} · ${reason}`,
                    zoneId: zone.id,
                });
                summary.errors += 1;
                continue;
            }
            const closedAt = clock.now();
            await db.update(irrigationCycles).set({ closedAt }).where(eq(irrigationCycles.id, cycle.id));
            handledZoneIds.add(zone.id);
            summary.forcedClosed += 1;
            console.warn(`daemon: reconcile force-closed cycle ${cycle.id} on zone ${zone.id} — relay was open past planned close ${plannedCloseAt.toISOString()}.`);
            await notifier('error', { zoneName: zone.name, operation: 'reconcile-overrun', reason: `relay still open past planned close ${plannedCloseAt.toISOString()}` });
            await alertRecorder({
                class: 'missed-close',
                tone: 'danger',
                title: 'Missed close (relay overran)',
                sub: `${zone.name} cycle relay was still open past planned close ${plannedCloseAt.toISOString()}`,
                zoneId: zone.id,
            });
            continue;
        }

        // state === 'off'
        const closedAt = plannedCloseAt.getTime() < now.getTime() ? plannedCloseAt : now;
        await db.update(irrigationCycles).set({ closedAt }).where(eq(irrigationCycles.id, cycle.id));
        handledZoneIds.add(zone.id);
        summary.missedClose += 1;
        console.log(`daemon: reconcile recorded missed close for cycle ${cycle.id} on zone ${zone.id} (set closed_at=${closedAt.toISOString()}).`);
        await alertRecorder({
            class: 'missed-close',
            tone: 'danger',
            title: 'Missed close',
            sub: `${zone.name} cycle missed expected close · set closed_at=${closedAt.toISOString()}`,
            zoneId: zone.id,
        });
    }

    for (const zone of managedZones) {
        if (handledZoneIds.has(zone.id)) continue;
        if (!zone.homeAssistantEntityId) continue;

        let state: ZoneRelayState;
        try {
            state = await getZoneState(zone);
        } catch (err) {
            const reason = errorMessage(err);
            console.error(`daemon: reconcile getZoneState failed during defensive sweep for zone ${zone.id}; skipping.`, err);
            await notifier('error', { zoneName: zone.name, operation: 'reconcile-sweep-state', reason });
            await alertRecorder({
                class: 'ha-call-failed',
                tone: 'danger',
                title: 'HA state query failed (sweep)',
                sub: `${zone.name} · ${reason}`,
                zoneId: zone.id,
            });
            summary.errors += 1;
            continue;
        }

        if (state !== 'on') continue;

        try {
            await closeZone(zone);
        } catch (err) {
            const reason = errorMessage(err);
            console.error(`daemon: reconcile orphan-close failed for zone ${zone.id}.`, err);
            await notifier('error', { zoneName: zone.name, operation: 'reconcile-orphan-close', reason });
            await alertRecorder({
                class: 'ha-call-failed',
                tone: 'danger',
                title: 'HA close failed (orphan)',
                sub: `${zone.name} · ${reason}`,
                zoneId: zone.id,
            });
            summary.errors += 1;
            continue;
        }
        summary.orphansClosed += 1;
        console.warn(`daemon: reconcile force-closed unmanaged-open zone ${zone.id} (${zone.homeAssistantEntityId}); no in-flight cycle backed it.`);
        await notifier('error', { zoneName: zone.name, operation: 'reconcile-orphan-close', reason: `relay was on at boot with no in-flight cycle` });
        await alertRecorder({
            class: 'ha-call-failed',
            tone: 'danger',
            title: 'Orphan relay closed',
            sub: `${zone.name} relay was on at boot with no in-flight cycle backing it`,
            zoneId: zone.id,
        });
    }

    return summary;
}

function errorMessage(err: unknown): string {
    if (err instanceof Error) return err.message;
    return String(err);
}
