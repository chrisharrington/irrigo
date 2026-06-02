import type { Alerter } from '@/alerts';
import type { ZoneRelayState } from '@/data/home-assistant';
import type { Zone } from '@/models';
import type { FutureCyclePair } from '@/models/cycle';
import type { Notifier } from '@/notifications';
import type { CategoryPushNotifier } from '@/service/push-tokens';
import { armCloseOnly as defaultArmCloseOnly, type ArmCloseOnlyInputs, type Clock, type TimerRegistry } from './runtime';
import { getScheduleEntriesRepo } from './state';

/**
 * Counters from a reconciliation pass. The daemon logs these in a single
 * summary line at startup so operators can tell at a glance whether the
 * previous shutdown left state behind that needed cleanup.
 */
export type ReconcileSummary = {
    resumed: number;
    forcedClosed: number;
    missedClose: number;
    orphansClosed: number;
    errors: number;
};

/**
 * Collaborators injected at construction. The schedule-entries repo (the
 * source of `loadInFlightCycles` and the cycle UPDATEs) is read from the
 * module-level state via `getScheduleEntriesRepo()`.
 *
 * `loadInFlightCycles` and `armCloseOnly` remain injectable so tests can
 * substitute spies without booting the daemon service.
 */
export type ReconcileDeps = {
    clock: Clock;
    registry: TimerRegistry;
    notifier: Notifier;
    /** Gated Expo push for lifecycle notifications, passed through to `armCloseOnly`. */
    pushNotify?: CategoryPushNotifier;
    alerter: Alerter;
    closeZone: (zone: Zone) => Promise<void>;
    getZoneState: (zone: Zone) => Promise<ZoneRelayState>;

    /**
     * Optional override for the in-flight loader. Defaults to the
     * schedule-entries repo's `loadInFlightCycles()` (requires `bootDaemonService`).
     */
    loadInFlightCycles?: () => Promise<FutureCyclePair[]>;

    /** Optional override for the close-only arm. Defaults to runtime's. */
    armCloseOnly?: (inputs: ArmCloseOnlyInputs) => void;

    /** Managed zones for the defensive sweep — caller supplies enabled zones with HA entities. */
    managedZones: ReadonlyArray<Zone>;
};

/**
 * Resumes or closes any cycle that was in-flight at the previous shutdown,
 * then defensively force-closes any managed zone that's open with no
 * in-flight cycle backing it.
 */
export async function reconcileCycleAndRelayState(deps: ReconcileDeps): Promise<ReconcileSummary> {
    const {
        clock, registry, notifier, pushNotify, alerter, closeZone, getZoneState, managedZones,
        loadInFlightCycles = () => getScheduleEntriesRepo().loadInFlightCycles(),
        armCloseOnly = defaultArmCloseOnly,
    } = deps;

    const summary: ReconcileSummary = { resumed: 0, forcedClosed: 0, missedClose: 0, orphansClosed: 0, errors: 0 };
    const handledZoneIds = new Set<string>();

    const inFlight = await loadInFlightCycles();

    for (const { cycle, zone } of inFlight) {
        const plannedCloseAt = new Date(cycle.startTime.getTime() + cycle.durationMin * 60_000);
        const now = clock.now();

        let state: ZoneRelayState;
        try {
            state = await getZoneState(zone);
        } catch (err) {
            const reason = errorMessage(err);
            console.error(`daemon: reconcile getZoneState failed for cycle ${cycle.id} on zone ${zone.id}; skipping.`, err);
            await alerter({
                class: 'ha-call-failed',
                tone: 'danger',
                title: 'HA state query failed',
                sub: `Last attempt failed: ${reason}.`,
                zoneId: zone.id,
                zoneName: zone.name,
            });
            summary.errors += 1;
            continue;
        }

        if (state === 'unknown') {
            console.warn(`daemon: reconcile got unknown state for cycle ${cycle.id} on zone ${zone.id}; leaving cycle untouched.`);
            continue;
        }

        if (state === 'on' && plannedCloseAt.getTime() > now.getTime()) {
            armCloseOnly({ clock, registry, zone, cycle, closeZone, notifier, pushNotify, alerter, plannedCloseAt });
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
                await alerter({
                    class: 'ha-call-failed',
                    tone: 'danger',
                    title: 'HA close failed during reconcile',
                    sub: `Last attempt failed: ${reason}.`,
                    zoneId: zone.id,
                    zoneName: zone.name,
                });
                summary.errors += 1;
                continue;
            }
            const closedAt = clock.now();
            await getScheduleEntriesRepo().markCycleClosed(cycle.id, closedAt);
            handledZoneIds.add(zone.id);
            summary.forcedClosed += 1;
            console.warn(`daemon: reconcile force-closed cycle ${cycle.id} on zone ${zone.id} — relay was open past planned close ${plannedCloseAt.toISOString()}.`);
            await alerter({
                class: 'missed-close',
                tone: 'danger',
                title: 'Missed close',
                sub: `Relay was still open past planned close at ${plannedCloseAt.toISOString()}.`,
                zoneId: zone.id,
                zoneName: zone.name,
            });
            continue;
        }

        // state === 'off'
        const closedAt = plannedCloseAt.getTime() < now.getTime() ? plannedCloseAt : now;
        await getScheduleEntriesRepo().markCycleClosed(cycle.id, closedAt);
        handledZoneIds.add(zone.id);
        summary.missedClose += 1;
        console.log(`daemon: reconcile recorded missed close for cycle ${cycle.id} on zone ${zone.id} (set closed_at=${closedAt.toISOString()}).`);
        await alerter({
            class: 'missed-close',
            tone: 'danger',
            title: 'Missed close',
            sub: `Cycle missed expected close; recorded closed at ${closedAt.toISOString()}.`,
            zoneId: zone.id,
            zoneName: zone.name,
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
            await alerter({
                class: 'ha-call-failed',
                tone: 'danger',
                title: 'HA state query failed during sweep',
                sub: `Last attempt failed: ${reason}.`,
                zoneId: zone.id,
                zoneName: zone.name,
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
            await alerter({
                class: 'ha-call-failed',
                tone: 'danger',
                title: 'HA close failed for orphan relay',
                sub: `Last attempt failed: ${reason}.`,
                zoneId: zone.id,
                zoneName: zone.name,
            });
            summary.errors += 1;
            continue;
        }
        summary.orphansClosed += 1;
        console.warn(`daemon: reconcile force-closed unmanaged-open zone ${zone.id} (${zone.homeAssistantEntityId}); no in-flight cycle backed it.`);
        await alerter({
            class: 'ha-call-failed',
            tone: 'danger',
            title: 'Orphan relay closed',
            sub: `Relay was on at boot with no in-flight cycle backing it.`,
            zoneId: zone.id,
            zoneName: zone.name,
        });
    }

    return summary;
}

function errorMessage(err: unknown): string {
    if (err instanceof Error) return err.message;
    return String(err);
}
