import { boolean, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { auditColumns } from './audit-columns';

/**
 * Singleton row backing the master irrigation kill switch. The id column is a
 * constant string ('singleton') so upserts always target the same row. The
 * migration seeds a row with `irrigationEnabled = true` so the read path
 * always returns a populated `since` timestamp the UI can render.
 *
 * `since` is bumped on every flip — both enable and disable — and represents
 * "the system has been in its current state since this instant."
 */
export const systemState = pgTable('system_state', {
    id: text('id').primaryKey(),
    irrigationEnabled: boolean('irrigation_enabled').notNull().default(true),
    since: timestamp('since', { withTimezone: true }).notNull().defaultNow(),
    ...auditColumns,
});

/**
 * The fixed primary key value used for the singleton row. Exported so the
 * reader and writer can avoid embedding the literal in every query.
 */
export const SYSTEM_STATE_SINGLETON_ID = 'singleton';
