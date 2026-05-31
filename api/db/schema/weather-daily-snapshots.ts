import { date, pgTable, real, timestamp, uuid } from 'drizzle-orm/pg-core';
import { auditColumns } from './audit-columns';
import { weatherSnapshots } from './weather-snapshots';

/**
 * The daily forecast series belonging to a `weather_snapshots` row — one row
 * per forecast day. Mirrors the `DailyWeather` model: `precipitationMm` is
 * Open-Meteo's all-inclusive `precipitation_sum` (rain + showers + snow), ET₀
 * is the reference evapotranspiration, and the sunrise/sunset instants are
 * captured for day/night context. The forecast-quantity columns are nullable
 * because the corresponding `DailyWeather` fields are optional. API-87.
 */
export const weatherDailySnapshots = pgTable('weather_daily_snapshots', {
    id: uuid('id').primaryKey().defaultRandom(),
    snapshotId: uuid('snapshot_id')
        .notNull()
        .references(() => weatherSnapshots.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    sunriseAt: timestamp('sunrise_at', { withTimezone: true }),
    sunsetAt: timestamp('sunset_at', { withTimezone: true }),
    precipitationMm: real('precipitation_mm'),
    et0MmPerDay: real('et0_mm_per_day'),
    ...auditColumns,
});
