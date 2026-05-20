import { eq, sql } from 'drizzle-orm';
import { SYSTEM_STATE_SINGLETON_ID, systemState } from '@/db/schema';

/**
 * Wire-format snapshot of the master irrigation kill switch. `since` is the
 * ISO-8601 UTC instant the system entered its current state — bumped on every
 * flip — so the mobile UI can render "off since 2:34 PM" labels.
 */
export type SystemStateDto = {
    irrigationEnabled: boolean;
    since: string;
};

/**
 * Minimal db interface used by the reader. Returns the singleton row (or
 * empty when, defensively, no seed exists yet).
 */
export type SystemStateReaderDb = {
    select: (cols: {
        irrigationEnabled: typeof systemState.irrigationEnabled;
        since: typeof systemState.since;
    }) => {
        from: (table: typeof systemState) => {
            where: (cond: unknown) => {
                limit: (n: number) => Promise<Array<{ irrigationEnabled: boolean; since: Date }>>;
            };
        };
    };
};

/**
 * Minimal db interface used by the writer. Mirrors the weather-state upsert
 * pattern — production passes Drizzle directly, tests pass a recording stub.
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
 * Composite for callers (the daemon, the HTTP wiring) that need both surfaces.
 */
export type SystemStateDb = SystemStateReaderDb & SystemStateWriterDb;

/**
 * Reads the singleton row backing the kill switch. The migration seeds the
 * row at table-creation time, so this should never miss in production — the
 * defensive fallback exists in case a migration was bypassed during dev. A
 * warn-log fires if the fallback path is taken so the discrepancy isn't
 * silent.
 *
 * @param db - Drizzle client (or compatible stub).
 * @returns DTO with the current flag value and ISO `since` timestamp.
 */
export async function getSystemState(db: SystemStateReaderDb): Promise<SystemStateDto> {
    const rows = await db
        .select({
            irrigationEnabled: systemState.irrigationEnabled,
            since: systemState.since,
        })
        .from(systemState)
        .where(eq(systemState.id, SYSTEM_STATE_SINGLETON_ID))
        .limit(1);

    const row = rows[0];
    if (!row) {
        console.warn('system: singleton row missing — falling back to enabled default. Re-run migrations.');
        return { irrigationEnabled: true, since: new Date(0).toISOString() };
    }
    return { irrigationEnabled: row.irrigationEnabled, since: row.since.toISOString() };
}

/**
 * Upserts the singleton row with the new flag and a fresh `since` timestamp.
 * Returns the post-update DTO so route handlers can echo the new state back
 * to the client without an extra read.
 *
 * @param db - Drizzle client (or compatible stub).
 * @param enabled - The new value of the `irrigationEnabled` flag.
 * @param now - Timestamp to write into `since`. Injectable so callers drive
 *   the clock under test.
 */
export async function setIrrigationEnabled(
    db: SystemStateWriterDb,
    enabled: boolean,
    now: Date,
): Promise<SystemStateDto> {
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

    console.log(`system: irrigationEnabled=${enabled} since=${now.toISOString()}.`);
    return { irrigationEnabled: enabled, since: now.toISOString() };
}
