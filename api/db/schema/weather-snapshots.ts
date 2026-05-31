import { pgTable, real, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { auditColumns } from './audit-columns';
import { zones } from './zones';

/**
 * One row per successful Open-Meteo fetch the daemon makes for a zone. Captures
 * the request provenance — which zone, the exact coordinates and timezone the
 * forecast was requested for, and when it was fetched — so a stored plan can be
 * tied back to the forecast that produced it (retrospectives: "why didn't the
 * upcoming rain change the schedule?"). The forecast itself lands in the child
 * `weather_daily_snapshots` / `weather_hourly_snapshots` rows. API-87.
 *
 * Append-only: a fresh row is written on every fetch and old rows are pruned to
 * a retention window by the recorder. Children cascade-delete with the parent.
 */
export const weatherSnapshots = pgTable('weather_snapshots', {
    id: uuid('id').primaryKey().defaultRandom(),
    zoneId: uuid('zone_id').notNull().references(() => zones.id),
    latitude: real('latitude').notNull(),
    longitude: real('longitude').notNull(),
    timezone: text('timezone').notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull(),
    ...auditColumns,
});
