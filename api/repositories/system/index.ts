import { eq, sql } from 'drizzle-orm';
import type { Database } from '@/db';
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
 * Domain interface backing the kill switch. Services depend on this
 * exclusively — they never see Drizzle's chain shape. Tests construct fake
 * implementations as plain object literals.
 */
export interface SystemStateRepository {
    findSingleton(): Promise<SystemStateRow | null>;
    upsertSingleton(enabled: boolean, now: Date): Promise<void>;
}

/**
 * Builds the production `SystemStateRepository` bound to a Drizzle client.
 * The factory is the bridge between Drizzle's query API and the domain
 * interface — services receive the constructed repository at boot time,
 * never see Drizzle directly. Factory unit tests pass a partial Drizzle
 * stub via `as unknown as Database`.
 *
 * @param db - Drizzle client.
 */
export function createSystemStateRepository(db: Database): SystemStateRepository {
    return {
        findSingleton: async () => {
            const rows = await db
                .select({
                    irrigationEnabled: systemState.irrigationEnabled,
                    since: systemState.since,
                })
                .from(systemState)
                .where(eq(systemState.id, SYSTEM_STATE_SINGLETON_ID))
                .limit(1);
            return rows[0] ?? null;
        },
        upsertSingleton: async (enabled, now) => {
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
        },
    };
}
