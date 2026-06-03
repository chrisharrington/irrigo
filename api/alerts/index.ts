/**
 * Operator-facing failure classes recorded by the daemon. The set is closed:
 * the schema has a `check` constraint on `alerts.class`, so widening the
 * union requires both a code change here and a new migration.
 */
export type AlertClass = 'weather-stale' | 'ha-call-failed' | 'missed-close' | 'actuation-stale';

/**
 * Visual severity used by the mobile app to colour the alert row. `warn`
 * paints amber; `danger` paints red. The schema also constrains this set.
 */
export type AlertTone = 'warn' | 'danger';

/**
 * Payload supplied by writers when a failure is detected. `zoneId` is
 * optional: zone-scoped failures pin to a zone, global failures (weather
 * stale) omit it. Dedup uses `(class, zoneId)` as the key.
 */
export type AlertEvent = {
    class: AlertClass;
    tone: AlertTone;
    title: string;
    sub?: string;
    zoneId?: string;
};

/**
 * Writer function signature. The daemon threads one of these alongside the
 * existing notifier so failure paths fire alerts via dependency injection.
 * Resolves whether or not persistence succeeded — callers fire-and-forget.
 */
export type Alerter = (event: AlertEvent) => Promise<void>;

/**
 * No-op alerter used as the daemon default and by tests that don't care
 * about alert side-effects. Never throws, never logs.
 */
export const noopAlerter: Alerter = async () => {};

/**
 * Outcome of an ack attempt. `'acked'` means the row went from unacked to
 * acked. `'already-acked'` means the row was already acked (a no-op,
 * idempotent for the HTTP layer). `'not-found'` means no row matched.
 */
export type AckResult = 'acked' | 'already-acked' | 'not-found';

/**
 * Wire shape served by `GET /alerts`. `when` is ISO-8601 UTC; the underlying
 * `whenAt` column is a `timestamptz`. `sub` and `zoneId` are nullable on the
 * wire — `null` rather than missing-key so the JSON parser doesn't need
 * special-cased presence checks.
 */
export type AlertDto = {
    id: string;
    class: AlertClass;
    tone: AlertTone;
    title: string;
    sub: string | null;
    when: string;
    zoneId: string | null;
    ack: boolean;
};

/**
 * Composite db interface for all four alert operations. The production
 * Drizzle `db` satisfies this directly; tests pass a recording stub.
 */
export type AlertsDb = {
    select: (...args: unknown[]) => unknown;
    insert: (...args: unknown[]) => unknown;
    update: (...args: unknown[]) => unknown;
};

export { createAlerter } from './write';
export { listActiveAlerts } from './read';
export { acknowledgeAlert, clearAlertsByClass } from './ack';
