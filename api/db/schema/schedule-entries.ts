import { date, pgTable, real, text, uuid } from 'drizzle-orm/pg-core';
import { auditColumns } from './audit-columns';
import { schedules } from './schedules';
import { zones } from './zones';

export const scheduleEntries = pgTable('schedule_entries', {
    id: uuid('id').primaryKey().defaultRandom(),
    zoneId: uuid('zone_id').notNull().references(() => zones.id),
    scheduleId: uuid('schedule_id').references(() => schedules.id),
    date: date('date').notNull(),
    appliedDepthMm: real('applied_depth_mm').notNull(),
    depletionBeforeMm: real('depletion_before_mm').notNull(),
    depletionAfterMm: real('depletion_after_mm').notNull(),
    source: text('source').notNull().default('scheduled'),
    ...auditColumns,
});
