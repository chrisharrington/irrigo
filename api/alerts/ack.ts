import { and, eq } from 'drizzle-orm';
import { alerts } from '@/db/schema';
import type { AckResult, AlertClass, AlertsDb } from '.';

/**
 * Narrow db interface used internally by the ack side. The composite
 * `AlertsDb` covers it; this alias describes the per-operation surface for
 * clarity in tests and for anyone tracing query shapes.
 */
type AlertAckDb = {
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
