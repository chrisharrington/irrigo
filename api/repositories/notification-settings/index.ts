import { eq, sql } from 'drizzle-orm';
import type { Database } from '@/db';
import { NOTIFICATION_SETTINGS_SINGLETON_ID, notificationSettings } from '@/db/schema';
import type { NotificationSettingsDto } from '@/models/notification-settings';

export { NOTIFICATION_SETTINGS_SINGLETON_ID };

/**
 * Raw DB shape of the singleton `notification_settings` row — the five flags,
 * no audit columns. Identical in shape to `NotificationSettingsDto`; kept as a
 * distinct alias so the repository boundary stays explicit.
 */
export type NotificationSettingsRow = NotificationSettingsDto;

/**
 * Domain interface backing the notification toggles. Services depend on this
 * exclusively — they never see Drizzle's chain shape. Tests construct fake
 * implementations as plain object literals.
 */
export interface NotificationSettingsRepository {
    findSingleton(): Promise<NotificationSettingsRow | null>;
    upsertSingleton(row: NotificationSettingsRow): Promise<void>;
}

/**
 * Builds the production `NotificationSettingsRepository` bound to a Drizzle
 * client. Mirrors `createSystemStateRepository`: a full-row upsert keyed on the
 * constant singleton id so writes always target the same row. Factory unit
 * tests pass a partial Drizzle stub via `as unknown as Database`.
 *
 * @param db - Drizzle client.
 */
export function createNotificationSettingsRepository(db: Database): NotificationSettingsRepository {
    return {
        findSingleton: async () => {
            const rows = await db
                .select({
                    scheduleStart: notificationSettings.scheduleStart,
                    scheduleEnd: notificationSettings.scheduleEnd,
                    wateringStart: notificationSettings.wateringStart,
                    wateringEnd: notificationSettings.wateringEnd,
                    error: notificationSettings.error,
                })
                .from(notificationSettings)
                .where(eq(notificationSettings.id, NOTIFICATION_SETTINGS_SINGLETON_ID))
                .limit(1);
            return rows[0] ?? null;
        },
        upsertSingleton: async (row) => {
            await db
                .insert(notificationSettings)
                .values({ id: NOTIFICATION_SETTINGS_SINGLETON_ID, ...row })
                .onConflictDoUpdate({
                    target: notificationSettings.id,
                    set: {
                        scheduleStart: sql`excluded.schedule_start`,
                        scheduleEnd: sql`excluded.schedule_end`,
                        wateringStart: sql`excluded.watering_start`,
                        wateringEnd: sql`excluded.watering_end`,
                        error: sql`excluded.error`,
                    },
                });
        },
    };
}
