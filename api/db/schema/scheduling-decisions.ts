import { date, pgTable, real, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { auditColumns } from './audit-columns';
import { schedules } from './schedules';
import { weatherSnapshots } from './weather-snapshots';
import { zones } from './zones';

/**
 * One row per zone, per replan, capturing the planner's decision for *tonight*
 * (day 0 of the planning horizon): whether it watered, skipped, or deferred,
 * the reason, the depletion before/after, the trigger threshold that gated the
 * decision, and a reference to the weather snapshot that drove it. Answers the
 * retrospective question "why didn't zone X water on night Y?" — the executed
 * plan (`schedule_entries`) only records the nights that *did* water. API-88.
 *
 * Append-only: a fresh row is written on every replan and old rows are pruned
 * to a retention window by the recorder. `weatherSnapshotId` is nullable with
 * `ON DELETE SET NULL` so the weather-snapshot retention prune (API-87) never
 * FK-fails and a decision outlives the snapshot it referenced.
 */
export const schedulingDecisions = pgTable('scheduling_decisions', {
    id: uuid('id').primaryKey().defaultRandom(),
    zoneId: uuid('zone_id').notNull().references(() => zones.id),
    scheduleId: uuid('schedule_id').references(() => schedules.id),
    date: date('date').notNull(),
    replanAt: timestamp('replan_at', { withTimezone: true }).notNull(),
    outcome: text('outcome').notNull(),
    reason: text('reason').notNull(),
    depletionBeforeMm: real('depletion_before_mm').notNull(),
    depletionAfterMm: real('depletion_after_mm').notNull(),
    triggerThresholdMm: real('trigger_threshold_mm').notNull(),
    weatherSnapshotId: uuid('weather_snapshot_id').references(() => weatherSnapshots.id, { onDelete: 'set null' }),
    ...auditColumns,
});
