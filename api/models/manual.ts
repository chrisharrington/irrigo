import type { Clock } from '@/service/daemon/runtime';
import type { Zone } from '@/models';
import type { Notifier } from '@/notifications';
import type { CategoryPushNotifier } from '@/service/push-tokens';

/**
 * Snapshot of the active manual fire (if any). Drives the HTTP status the
 * mobile app shows on the Zone detail screen. `willCloseAt` is the scheduled
 * auto-close instant set by `run()`; `null` after the bare `open()` path,
 * which has no auto-close.
 */
export type ActiveManualSnapshot = {
    zoneId: string;
    zoneName: string;
    since: Date;
    willCloseAt: Date | null;
};

/**
 * Collaborators injected into `createManualController`. No `db` here — the
 * controller pulls its `ManualRepository` from module-level state set by
 * `bootManualService` at process startup.
 */
export type ManualControllerDeps = {
    clock: Clock;
    openZone: (zone: Zone) => Promise<void>;
    closeZone: (zone: Zone) => Promise<void>;
    notifier: Notifier;
    /**
     * Gated Expo push for watering-lifecycle notifications. Defaults to a noop
     * when unset. The HA `notifier` above still carries manual *error*
     * notifications until API-50 retires it.
     */
    pushNotify?: CategoryPushNotifier;

    /**
     * Returns true if a scheduled cycle is currently in-flight. The controller
     * uses this to refuse manual fires while the daemon owns the relay.
     */
    isAnyScheduledInFlight: () => boolean;

    /**
     * Returns the current state of the master irrigation kill switch. The
     * controller queries this at the top of `open` and `run` so a flipped-off
     * system can't accept new manual fires. `close` and `shutdown` are NOT
     * gated — closing an already-open relay must always be possible.
     */
    isIrrigationEnabled: () => Promise<boolean>;
};

/**
 * Public surface of the manual fire controller. Wired into HTTP routes.
 */
export type ManualController = {
    /** Opens the zone's relay. Returns when HA acknowledges the turn_on. */
    open: (zone: Zone) => Promise<{ since: Date }>;

    /**
     * Closes the zone's relay. Idempotent: if the controller has no record
     * of this zone being open, it still issues HA's `turn_off` (itself
     * idempotent) and returns success.
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
