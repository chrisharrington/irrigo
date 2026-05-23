import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { alerts } from '@/db/schema';
import type { PushDispatcher } from '@/models/push-token';
import type { Notifier } from '@/notifications';

/**
 * Operator-facing failure classes recorded by the daemon. The set is closed:
 * the schema has a `check (class in ('weather-stale', 'ha-call-failed',
 * 'missed-close'))` constraint, so widening the union requires both a code
 * change here and a new migration.
 */
export type AlertClass = 'weather-stale' | 'ha-call-failed' | 'missed-close';

/**
 * Visual severity used by the mobile app to colour the alert row. `warn`
 * paints amber; `danger` paints red. The schema also constrains this set.
 */
export type AlertTone = 'warn' | 'danger';

/**
 * Payload supplied by writers when a failure is detected. `zoneId` is
 * optional: zone-scoped failures pin to a zone, global failures (weather
 * stale) omit it. Dedup uses `(class, zoneId)` as the key.
 *
 * `zoneName` is transport-only context for the optional HA push fired by the
 * alerter — it is not persisted on the alert row (the same name is already
 * baked into `sub` for the UI to render). Callers pass it alongside `zoneId`
 * when they have a `Zone` in hand at the failure site.
 */
export type AlertEvent = {
    class: AlertClass;
    tone: AlertTone;
    title: string;
    sub?: string;
    zoneId?: string;
    zoneName?: string;
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

type AlertRow = typeof alerts.$inferSelect;

/**
 * Composite db interface for all four alert operations. The production
 * Drizzle `db` satisfies this directly; tests pass a recording stub.
 */
export type AlertsDb = {
    select: (...args: unknown[]) => unknown;
    insert: (...args: unknown[]) => unknown;
    update: (...args: unknown[]) => unknown;
};

function rowToDto(row: AlertRow): AlertDto {
    return {
        id: row.id,
        class: row.class as AlertClass,
        tone: row.tone as AlertTone,
        title: row.title,
        sub: row.sub,
        when: row.whenAt.toISOString(),
        zoneId: row.zoneId,
        ack: row.ack,
    };
}

/**
 * Builds the production `Alerter` bound to the supplied Drizzle client.
 * Dedupes by `(class, zoneId)`: if an unacked row already exists for that key
 * the alerter updates `whenAt = now()`, `title`, `sub`, and `tone`. Acked
 * rows are left alone so the next failure creates a fresh row visible to the
 * UI again.
 *
 * If `notifier` is supplied, the alerter also fires an HA push notification
 * — but **only on insert** (a brand-new alert), not on update (a duplicate of
 * an active condition). This keeps push notifications "loud once, quiet until
 * acked," matching the design's *"loud when present, gone when not"* intent
 * and avoiding the spam loop that prompted API-40.
 *
 * If `pushDispatcher` is supplied, the alerter also fires an Expo Push to
 * every registered device — again, **only on insert**, never on dedup-update.
 * Dispatcher errors are caught and logged at `warn` so a transport failure
 * never disrupts the alert write.
 *
 * @param db - Drizzle client (typed loosely so tests can supply a recording stub).
 * @param notifier - Optional HA push channel. Fires on new alerts only.
 * @param pushDispatcher - Optional Expo Push channel. Fires on new alerts only.
 * @returns An `Alerter` closure that persists to the `alerts` table.
 */
export function createAlerter(db: AlertsDb, notifier?: Notifier, pushDispatcher?: PushDispatcher): Alerter {
    return async event => {
        const matchExisting = and(
            eq(alerts.class, event.class),
            eq(alerts.ack, false),
            event.zoneId !== undefined ? eq(alerts.zoneId, event.zoneId) : isNull(alerts.zoneId),
        );

        const existing = await (db as unknown as AlerterDb)
            .select({ id: alerts.id })
            .from(alerts)
            .where(matchExisting)
            .limit(1);

        if (existing.length > 0) {
            const id = existing[0]!.id;
            await (db as unknown as AlerterDb)
                .update(alerts)
                .set({
                    whenAt: sql`now()`,
                    title: event.title,
                    sub: event.sub ?? null,
                    tone: event.tone,
                })
                .where(eq(alerts.id, id));
            console.log(`alerts: refreshed ${event.class} alert ${id}.`);
            return;
        }

        const inserted = await (db as unknown as AlerterDb)
            .insert(alerts)
            .values({
                class: event.class,
                tone: event.tone,
                title: event.title,
                sub: event.sub ?? null,
                zoneId: event.zoneId ?? null,
            })
            .returning({ id: alerts.id });
        const alertId = inserted[0]!.id;
        console.log(`alerts: inserted new ${event.class} alert.`);

        if (notifier) {
            await notifier('error', {
                ...(event.zoneName !== undefined ? { zoneName: event.zoneName } : {}),
                errorTitle: event.title,
                ...(event.sub !== undefined ? { errorSub: event.sub } : {}),
            });
        }

        if (pushDispatcher) {
            await pushDispatcher({
                alertId,
                class: event.class,
                tone: event.tone,
                title: event.title,
                sub: event.sub ?? null,
                zoneId: event.zoneId ?? null,
            }).catch(err => console.warn('alerts: push dispatcher failed; swallowing.', err));
        }
    };
}

/**
 * Returns every unacked alert as a DTO, newest first. Used by the
 * `GET /alerts` endpoint.
 *
 * @param db - Drizzle client (or compatible stub).
 * @returns The list of `AlertDto`s.
 */
export async function listActiveAlerts(db: AlertsDb): Promise<AlertDto[]> {
    const rows = await (db as unknown as AlertReaderDb)
        .select()
        .from(alerts)
        .where(eq(alerts.ack, false))
        .orderBy(desc(alerts.whenAt));
    return rows.map(rowToDto);
}

/**
 * Flips `ack = true` on the matching row and reports whether the row existed
 * and whether it was already acked. Lets the HTTP route map outcomes to
 * status codes — 200 for acked / already-acked (idempotent), 404 for
 * not-found.
 *
 * @param db - Drizzle client (or compatible stub).
 * @param id - The alert UUID.
 * @returns `'acked'`, `'already-acked'`, or `'not-found'`.
 */
export async function acknowledgeAlert(db: AlertsDb, id: string): Promise<AckResult> {
    const updated = await (db as unknown as AlertAckDb)
        .update(alerts)
        .set({ ack: true })
        .where(and(eq(alerts.id, id), eq(alerts.ack, false)))
        .returning({ id: alerts.id });
    if (updated.length > 0) return 'acked';

    const existing = await (db as unknown as AlertAckDb)
        .select({ id: alerts.id })
        .from(alerts)
        .where(eq(alerts.id, id))
        .limit(1);
    return existing.length > 0 ? 'already-acked' : 'not-found';
}

/**
 * Marks every unacked row of `class` as acked. Used by the weather-recovery
 * path so the alert region collapses automatically when the next successful
 * forecast lands.
 *
 * @param db - Drizzle client (or compatible stub).
 * @param klass - Which alert class to clear.
 */
export async function clearAlertsByClass(db: AlertsDb, klass: AlertClass): Promise<void> {
    await (db as unknown as AlertAckDb)
        .update(alerts)
        .set({ ack: true })
        .where(and(eq(alerts.class, klass), eq(alerts.ack, false)));
}

/**
 * Narrow db interfaces used internally. The composite `AlertsDb` covers them
 * all; these aliases describe the per-operation surface for clarity in tests
 * and for anyone tracing query shapes.
 */
export type AlerterDb = {
    select: (cols: { id: typeof alerts.id }) => {
        from: (table: typeof alerts) => {
            where: (cond: unknown) => {
                limit: (n: number) => Promise<Array<{ id: string }>>;
            };
        };
    };
    insert: (table: typeof alerts) => {
        values: (row: Record<string, unknown>) => {
            returning: (cols: { id: typeof alerts.id }) => Promise<Array<{ id: string }>>;
        };
    };
    update: (table: typeof alerts) => {
        set: (values: Record<string, unknown>) => {
            where: (cond: unknown) => Promise<unknown>;
        };
    };
};

export type AlertReaderDb = {
    select: () => {
        from: (table: typeof alerts) => {
            where: (cond: unknown) => {
                orderBy: (...exprs: unknown[]) => Promise<AlertRow[]>;
            };
        };
    };
};

export type AlertAckDb = {
    update: (table: typeof alerts) => {
        set: (values: Record<string, unknown>) => {
            where: (cond: unknown) => {
                returning: (cols: { id: typeof alerts.id }) => Promise<Array<{ id: string }>>;
            } & Promise<unknown>;
        };
    };
    select: (cols: { id: typeof alerts.id }) => {
        from: (table: typeof alerts) => {
            where: (cond: unknown) => {
                limit: (n: number) => Promise<Array<{ id: string }>>;
            };
        };
    };
};
