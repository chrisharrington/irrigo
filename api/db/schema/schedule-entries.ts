import { date, pgTable, real, text, timestamp, uuid } from 'drizzle-orm/pg-core';
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
    // Sunrise of `date`, captured at planning time. Powers GET /tonight's
    // CycleStrip rendering without an extra weather fetch. Nullable so legacy
    // rows (and rows from a planner that hasn't been re-run since this column
    // was added) read as null — the wire layer surfaces that as `null`.
    sunriseAt: timestamp('sunrise_at', { withTimezone: true }),
    // Sunset of `date - 1` (the previous evening). The overnight irrigation
    // block spans `[sunsetAt, sunriseAt]`. Same nullable rationale.
    sunsetAt: timestamp('sunset_at', { withTimezone: true }),
    ...auditColumns,
});
