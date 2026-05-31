import { pgTable, real, timestamp, uuid } from 'drizzle-orm/pg-core';
import { auditColumns } from './audit-columns';
import { weatherSnapshots } from './weather-snapshots';

/**
 * The hourly forecast series belonging to a `weather_snapshots` row — one row
 * per hour. Mirrors the `HourlyWeather` model the reconciler consumes:
 * `precipitationMm` is the total precipitation in the hour and `et0Mm` the
 * reference evapotranspiration. Both are non-null (the model fields are
 * required). API-87.
 */
export const weatherHourlySnapshots = pgTable('weather_hourly_snapshots', {
    id: uuid('id').primaryKey().defaultRandom(),
    snapshotId: uuid('snapshot_id')
        .notNull()
        .references(() => weatherSnapshots.id, { onDelete: 'cascade' }),
    time: timestamp('time', { withTimezone: true }).notNull(),
    precipitationMm: real('precipitation_mm').notNull(),
    et0Mm: real('et0_mm').notNull(),
    ...auditColumns,
});
