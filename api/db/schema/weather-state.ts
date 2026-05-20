import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { auditColumns } from './audit-columns';

/**
 * Singleton row tracking when the planner last successfully pulled weather
 * data. The id column is a constant string ('singleton') so upserts always
 * target the same row. `lastSuccessfulFetchAt` is null until the first
 * successful re-plan; the daemon treats null as "stale" and records a
 * `weather-stale` alert on the next failed attempt.
 */
export const weatherState = pgTable('weather_state', {
    id: text('id').primaryKey(),
    lastSuccessfulFetchAt: timestamp('last_successful_fetch_at', { withTimezone: true }),
    ...auditColumns,
});

/**
 * The fixed primary key value used for the singleton row. Exported so the
 * recorder and reader can avoid embedding the literal in every query.
 */
export const WEATHER_STATE_SINGLETON_ID = 'singleton';
