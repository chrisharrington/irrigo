import { pgTable, real, timestamp, uuid } from 'drizzle-orm/pg-core';
import { auditColumns } from './audit-columns';
import { scheduleEntries } from './schedule-entries';

export const irrigationCycles = pgTable('irrigation_cycles', {
    id: uuid('id').primaryKey().defaultRandom(),
    scheduleEntryId: uuid('schedule_entry_id')
        .notNull()
        .references(() => scheduleEntries.id, { onDelete: 'cascade' }),
    startTime: timestamp('start_time', { withTimezone: true }).notNull(),
    durationMin: real('duration_min').notNull(),
    firedAt: timestamp('fired_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    ...auditColumns,
});
