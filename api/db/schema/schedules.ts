import { sql } from 'drizzle-orm';
import { boolean, integer, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { auditColumns } from './audit-columns';
import { sites } from './sites';

/**
 * One allowed irrigation window within a day. Hours and minutes in the
 * site's local timezone. Windows do not wrap past midnight — represent
 * overnight allowances as two windows on consecutive days.
 */
export type ScheduleTimeWindow = {
    start: string;
    end: string;
};

/**
 * Named irrigation schedules (e.g. `Maintenance`, `Overseeding`). Each site
 * has at most one active schedule at a time — enforced by the partial unique
 * index `schedules_one_active_per_site`. The active schedule's id is stamped
 * onto every `schedule_entries` row the planner writes.
 *
 * `allowedDays` and `allowedTimeWindows` express municipal water-restriction
 * compliance: nullable so existing rows behave as "no restriction" until an
 * operator opts in. `allowedDays` uses ISO weekday numbers (1=Mon..7=Sun).
 */
export const schedules = pgTable('schedules', {
    id: uuid('id').primaryKey().defaultRandom(),
    siteId: uuid('site_id').notNull().references(() => sites.id),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    isActive: boolean('is_active').notNull().default(false),
    allowedDays: integer('allowed_days').array(),
    allowedTimeWindows: jsonb('allowed_time_windows').$type<ScheduleTimeWindow[]>(),
    ...auditColumns,
}, table => [
    uniqueIndex('schedules_site_slug_idx').on(table.siteId, table.slug),
    uniqueIndex('schedules_one_active_per_site').on(table.siteId).where(sql`${table.isActive}`),
]);
