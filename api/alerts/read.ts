import { desc, eq } from 'drizzle-orm';
import { alerts } from '@/db/schema';
import type { AlertClass, AlertDto, AlertsDb, AlertTone } from '.';

type AlertRow = typeof alerts.$inferSelect;

/**
 * Narrow db interface used internally by the read side. The composite
 * `AlertsDb` covers it; this alias describes the per-operation surface for
 * clarity in tests and for anyone tracing query shapes.
 */
type AlertReaderDb = {
    select: () => {
        from: (table: typeof alerts) => {
            where: (cond: unknown) => {
                orderBy: (...exprs: unknown[]) => Promise<AlertRow[]>;
            };
        };
    };
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
