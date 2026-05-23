import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { Database } from '@/db';
import { alerts } from '@/db/schema';
import type { AlertClass, AlertDto, AlertTone } from '@/models/alert';

type AlertRow = typeof alerts.$inferSelect;

/**
 * Row payload for `insertAlert`. Mirrors the columns the alerter writes when
 * creating a new alert; `sub` and `zoneId` are nullable on the table so the
 * insert is shape-faithful to the wire DTO.
 */
export type AlertInsertRow = {
    class: AlertClass;
    tone: AlertTone;
    title: string;
    sub: string | null;
    zoneId: string | null;
};

/**
 * Update payload for `updateAlert`. All fields are optional — used by both
 * the dedup-refresh path (`whenAt`, `title`, `sub`, `tone`) and the
 * acknowledge path (`ack: true`).
 */
export type AlertUpdate = {
    whenAt?: Date | ReturnType<typeof sql>;
    title?: string;
    sub?: string | null;
    tone?: AlertTone;
    ack?: boolean;
};

/**
 * Domain interface for the alerts table. The service depends on this
 * exclusively — it never sees Drizzle's chain shape. Tests construct fakes as
 * plain object literals.
 */
export interface AlertsRepository {
    /**
     * Returns every unacked alert as a DTO, newest first. Backs the
     * `GET /alerts` endpoint.
     */
    listUnacked(): Promise<AlertDto[]>;

    /**
     * Returns the alert with the given id, or `null` if no such row exists.
     * Used by the ack flow to distinguish `'already-acked'` from `'not-found'`.
     */
    findById(id: string): Promise<AlertDto | null>;

    /**
     * Returns the unacked row that matches the dedup key `(class, zoneId)`,
     * or `null` when no active alert of that class is pinned to that zone.
     * The alerter uses this to decide insert-vs-update.
     */
    findUnackedByDedupKey(klass: AlertClass, zoneId: string | undefined): Promise<{ id: string } | null>;

    /**
     * Inserts a brand-new alert row. The schema defaults `whenAt` to `now()`
     * and `ack` to `false`, so the caller only supplies the dedup + display
     * fields.
     */
    insertAlert(row: AlertInsertRow): Promise<void>;

    /**
     * Generic update — used by the dedup-refresh path (sets `whenAt`,
     * `title`, `sub`, `tone`) and the acknowledge path (sets `ack: true`).
     */
    updateAlert(id: string, set: AlertUpdate): Promise<void>;

    /**
     * Flips `ack = true` on every unacked row of `klass`. Used by the
     * weather-recovery path so the alert region collapses automatically when
     * the next successful forecast lands.
     */
    markAckedByClass(klass: AlertClass): Promise<void>;
}

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
 * Builds the production `AlertsRepository` bound to a Drizzle client. Tests
 * pass a partial stub via `as unknown as Database`.
 */
export function createAlertsRepository(db: Database): AlertsRepository {
    return {
        listUnacked: async () => {
            const rows = await db
                .select()
                .from(alerts)
                .where(eq(alerts.ack, false))
                .orderBy(desc(alerts.whenAt));
            return rows.map(rowToDto);
        },

        findById: async (id) => {
            const rows = await db
                .select()
                .from(alerts)
                .where(eq(alerts.id, id))
                .limit(1);
            const row = rows[0];
            return row ? rowToDto(row) : null;
        },

        findUnackedByDedupKey: async (klass, zoneId) => {
            const rows = await db
                .select({ id: alerts.id })
                .from(alerts)
                .where(and(
                    eq(alerts.class, klass),
                    eq(alerts.ack, false),
                    zoneId !== undefined ? eq(alerts.zoneId, zoneId) : isNull(alerts.zoneId),
                ))
                .limit(1);
            return rows[0] ?? null;
        },

        insertAlert: async (row) => {
            await db.insert(alerts).values({
                class: row.class,
                tone: row.tone,
                title: row.title,
                sub: row.sub,
                zoneId: row.zoneId,
            });
        },

        updateAlert: async (id, set) => {
            await db
                .update(alerts)
                .set(set)
                .where(eq(alerts.id, id));
        },

        markAckedByClass: async (klass) => {
            await db
                .update(alerts)
                .set({ ack: true })
                .where(and(eq(alerts.class, klass), eq(alerts.ack, false)));
        },
    };
}
