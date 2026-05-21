import { eq, sql } from 'drizzle-orm';
import { SYSTEM_STATE_SINGLETON_ID, systemState } from '@/db/schema';

export { SYSTEM_STATE_SINGLETON_ID };

/**
 * Raw DB shape of the singleton `system_state` row. `since` stays a JS Date
 * here — the service layer is responsible for ISO conversion at the wire
 * boundary.
 */
export type SystemStateRow = {
    irrigationEnabled: boolean;
    since: Date;
};

/**
 * Minimal db interface for the singleton row read. Returns either the row
 * or empty (defensively — the migration seeds the singleton, so a missing
 * row indicates a bypassed migration).
 */
export type SystemStateReaderDb = {
    select: (cols: {
        irrigationEnabled: typeof systemState.irrigationEnabled;
        since: typeof systemState.since;
    }) => {
        from: (table: typeof systemState) => {
            where: (cond: unknown) => {
                limit: (n: number) => Promise<Array<SystemStateRow>>;
            };
        };
    };
};

/**
 * Minimal db interface for the singleton row upsert. Production passes
 * Drizzle directly; tests pass a recording stub.
 */
export type SystemStateWriterDb = {
    insert: (table: typeof systemState) => {
        values: (row: Record<string, unknown>) => {
            onConflictDoUpdate: (config: {
                target: unknown;
                set: Record<string, unknown>;
            }) => Promise<unknown>;
        };
    };
};

/**
 * Composite for callers (services, the daemon, the HTTP wiring) that need
 * both surfaces.
 */
export type SystemStateDb = SystemStateReaderDb & SystemStateWriterDb;

/**
 * Reads the singleton row backing the kill switch. Returns `null` when the
 * row is missing (a bypassed migration) — the service layer decides whether
 * to fall back, warn, or surface the gap upstream. This function never logs
 * or maps to a DTO.
 *
 * @param db - Drizzle client (or compatible stub).
 */
export async function loadSystemState(db: SystemStateReaderDb): Promise<SystemStateRow | null> {
    const rows = await db
        .select({
            irrigationEnabled: systemState.irrigationEnabled,
            since: systemState.since,
        })
        .from(systemState)
        .where(eq(systemState.id, SYSTEM_STATE_SINGLETON_ID))
        .limit(1);
    return rows[0] ?? null;
}

/**
 * Upserts the singleton row with the new flag and timestamp. The service
 * layer logs and returns the post-update DTO; this function is silent.
 *
 * @param db - Drizzle client (or compatible stub).
 * @param enabled - The new value of the `irrigationEnabled` flag.
 * @param now - Timestamp to write into `since`.
 */
export async function upsertSystemState(db: SystemStateWriterDb, enabled: boolean, now: Date): Promise<void> {
    await db
        .insert(systemState)
        .values({ id: SYSTEM_STATE_SINGLETON_ID, irrigationEnabled: enabled, since: now })
        .onConflictDoUpdate({
            target: systemState.id,
            set: {
                irrigationEnabled: sql`excluded.irrigation_enabled`,
                since: sql`excluded.since`,
            },
        });
}
