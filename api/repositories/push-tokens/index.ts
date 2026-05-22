import { asc, eq, sql } from 'drizzle-orm';
import type { Database } from '@/db';
import { pushTokens } from '@/db/schema';

/**
 * Single-row representation of a `push_tokens` row, derived from Drizzle's
 * inferred row type. Re-exported so service / consumer code never needs to
 * import directly from `@/db/schema`.
 */
export type PushToken = typeof pushTokens.$inferSelect;

/**
 * Domain interface for the push_tokens table. The service depends on this
 * exclusively — it never sees Drizzle's chain shape. Tests construct fakes
 * as plain object literals.
 */
export interface PushTokensRepository {
    /**
     * Upserts a token row keyed by the unique `token` column. Existing rows
     * have their `platform`, `user_agent`, and `updated_at` refreshed. Used
     * by `POST /push/register` to register / re-register a device in one call.
     */
    upsertByToken(input: { token: string; platform: 'ios' | 'android'; userAgent: string | null }): Promise<void>;

    /**
     * Deletes the row matching `token`. Idempotent — resolves successfully
     * even when no row matches (no-op delete). Used by `POST /push/unregister`
     * and by the dispatcher's `DeviceNotRegistered` prune path.
     */
    deleteByToken(token: string): Promise<void>;

    /**
     * Returns every registered token in insertion order (`created_at ASC`)
     * for deterministic dispatcher fanout. Empty array when no devices have
     * registered yet — common during cold start.
     */
    listAll(): Promise<PushToken[]>;
}

/**
 * Builds the production `PushTokensRepository` bound to a Drizzle client.
 * Tests pass a partial stub via `as unknown as Database`.
 */
export function createPushTokensRepository(db: Database): PushTokensRepository {
    return {
        upsertByToken: async ({ token, platform, userAgent }) => {
            await db
                .insert(pushTokens)
                .values({ token, platform, userAgent })
                .onConflictDoUpdate({
                    target: pushTokens.token,
                    set: {
                        platform: sql`excluded.platform`,
                        userAgent: sql`excluded.user_agent`,
                        updatedAt: sql`now()`,
                    },
                });
        },

        deleteByToken: async (token) => {
            await db.delete(pushTokens).where(eq(pushTokens.token, token));
        },

        listAll: async () => {
            return db
                .select()
                .from(pushTokens)
                .orderBy(asc(pushTokens.createdAt));
        },
    };
}
