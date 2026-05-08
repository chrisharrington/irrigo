import { sql } from 'drizzle-orm';
import { boolean, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { auditColumns } from './audit-columns';
import { sites } from './sites';

/**
 * Named irrigation schedules (e.g. `Maintenance`, `Overseeding`). Each site
 * has at most one active schedule at a time — enforced by the partial unique
 * index `schedules_one_active_per_site`. The active schedule's id is stamped
 * onto every `schedule_entries` row the planner writes.
 */
export const schedules = pgTable('schedules', {
    id: uuid('id').primaryKey().defaultRandom(),
    siteId: uuid('site_id').notNull().references(() => sites.id),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    isActive: boolean('is_active').notNull().default(false),
    ...auditColumns,
}, table => [
    uniqueIndex('schedules_site_slug_idx').on(table.siteId, table.slug),
    uniqueIndex('schedules_one_active_per_site').on(table.siteId).where(sql`${table.isActive}`),
]);
