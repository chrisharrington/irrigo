import { boolean, pgTable, text } from 'drizzle-orm/pg-core';
import { auditColumns } from './audit-columns';

/**
 * Singleton row backing the operator's notification preferences — the five
 * per-event toggles the mobile settings screen reads and PATCHes. The id
 * column is a constant string ('singleton') so upserts always target the same
 * row. The migration seeds a row whose defaults match the historical
 * `NOTIFY_ON_*` env defaults so first-boot behaviour is preserved.
 *
 * Replaces the env-snapshot the notifier used to read at construction time
 * (API-101): the row is now the source of truth, read live on each event.
 */
export const notificationSettings = pgTable('notification_settings', {
    id: text('id').primaryKey(),
    scheduleStart: boolean('schedule_start').notNull().default(true),
    scheduleEnd: boolean('schedule_end').notNull().default(true),
    wateringStart: boolean('watering_start').notNull().default(false),
    wateringEnd: boolean('watering_end').notNull().default(false),
    error: boolean('error').notNull().default(true),
    ...auditColumns,
});

/**
 * The fixed primary key value used for the singleton row. Exported so the
 * reader and writer can avoid embedding the literal in every query.
 */
export const NOTIFICATION_SETTINGS_SINGLETON_ID = 'singleton';
