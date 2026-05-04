import { timestamp } from 'drizzle-orm/pg-core';

/**
 * Project-standard audit columns. Every table includes these — created_at stamps
 * on insert, updated_at stamps on insert and bumps on each update.
 */
export const auditColumns = {
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
        .notNull()
        .defaultNow()
        .$onUpdate(() => new Date()),
};
