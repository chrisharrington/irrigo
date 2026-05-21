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
 * Domain interface backing the kill switch. Services depend on this
 * exclusively — they never see Drizzle's chain shape. Tests construct fake
 * implementations as plain object literals.
 */
export interface SystemStateRepository {
    findSingleton(): Promise<SystemStateRow | null>;
    upsertSingleton(enabled: boolean, now: Date): Promise<void>;
}

/**
 * Narrow Drizzle-shaped surface the factory needs to build a repository.
 * This is the one place where Drizzle's chain types leak — production
 * passes the real `db` (which satisfies this structurally); factory tests
 * pass a stub matching this shape. Consumers of the repository interface
 * never see this type.
 */
export type SystemStateRepositoryDb = {
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
 * Builds the production `SystemStateRepository` bound to a Drizzle client.
 * The factory is the bridge between Drizzle's query API and the domain
 * interface — services never invoke this directly; they receive the
 * constructed repository from the composition root (api/index.ts, the
 * daemon's start, the tonight handler, etc.).
 *
 * @param db - Drizzle client (or compatible stub).
 */
export function createSystemStateRepository(db: SystemStateRepositoryDb): SystemStateRepository {
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
