import { and, eq, isNull, sql } from 'drizzle-orm';
import { alerts } from '@/db/schema';
import type { PushDispatcher } from '@/models/push-token';
import type { AlertEvent, Alerter, AlertsDb } from '.';

/**
 * Narrow db interface used internally by the write side. The composite
 * `AlertsDb` covers it; this alias describes the per-operation surface for
 * clarity in tests and for anyone tracing query shapes.
 */
type AlerterDb = {
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

/**
 * Builds the production `Alerter` bound to the supplied Drizzle client.
 * Dedupes by `(class, zoneId)`: if an unacked row already exists for that key
 * the alerter updates `whenAt = now()`, `title`, `sub`, and `tone`. Acked
 * rows are left alone so the next failure creates a fresh row visible to the
 * UI again.
 *
 * If `pushDispatcher` is supplied, the alerter also fires an Expo Push to
 * every registered device — but **only on insert** (a brand-new alert), not on
 * update (a duplicate of an active condition). This keeps push notifications
 * "loud once, quiet until acked," matching the design's *"loud when present,
 * gone when not"* intent and avoiding the spam loop that prompted API-40.
 * Dispatcher errors are caught and logged at `warn` so a transport failure
 * never disrupts the alert write.
 *
 * @param db - Drizzle client (typed loosely so tests can supply a recording stub).
 * @param pushDispatcher - Optional Expo Push channel. Fires on new alerts only.
 * @returns An `Alerter` closure that persists to the `alerts` table.
 */
export function createAlerter(db: AlertsDb, pushDispatcher?: PushDispatcher): Alerter {
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
