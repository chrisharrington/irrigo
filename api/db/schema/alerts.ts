import { sql } from 'drizzle-orm';
import { boolean, check, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { auditColumns } from './audit-columns';
import { zones } from './zones';

/**
 * Operator-facing failure records. The daemon writes a row whenever a failure
 * the operator should know about happens — HA call failed, planner running on
 * stale weather, scheduled close was missed at boot. The mobile app reads
 * unacked rows out of `GET /alerts` to drive the persistent alert region.
 *
 * Dedup is application-level: at most one unacked row per `(class, zoneId)`
 * exists at a time. Repeated failures of the same class update the existing
 * row's `whenAt` and content. Acking via `POST /alerts/:id/ack` flips `ack`
 * to true; a subsequent failure of the same class will insert a fresh row
 * rather than touch the acked history.
 */
export const alerts = pgTable('alerts', {
    id: uuid('id').primaryKey().defaultRandom(),
    class: text('class').notNull(),
    tone: text('tone').notNull(),
    title: text('title').notNull(),
    sub: text('sub'),
    whenAt: timestamp('when_at', { withTimezone: true }).notNull().defaultNow(),
    zoneId: uuid('zone_id').references(() => zones.id),
    ack: boolean('ack').notNull().default(false),
    ...auditColumns,
}, (table) => [
    check('alerts_class_check', sql`${table.class} in ('weather-stale', 'ha-call-failed', 'missed-close')`),
    check('alerts_tone_check', sql`${table.tone} in ('warn', 'danger')`),
]);
