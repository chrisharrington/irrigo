import { lt } from 'drizzle-orm';
import dayjs from 'dayjs';
import type { Database } from '@/db';
import { weatherDailySnapshots, weatherHourlySnapshots, weatherSnapshots } from '@/db/schema';
import type { WeatherData } from '@/models';

/**
 * Default retention window (days) for persisted weather snapshots. Old
 * snapshots are pruned on each write so the append-only log stays bounded;
 * four weeks is enough history for scheduling retrospectives without
 * unbounded growth. Overridable via the `WEATHER_SNAPSHOT_RETENTION_DAYS`
 * environment variable. A value of 0 disables pruning. API-87.
 */
export const DEFAULT_WEATHER_SNAPSHOT_RETENTION_DAYS = 28;

/**
 * Resolves the snapshot retention window from the
 * `WEATHER_SNAPSHOT_RETENTION_DAYS` environment variable. Accepts any
 * non-negative integer (0 disables pruning); falls back to
 * `DEFAULT_WEATHER_SNAPSHOT_RETENTION_DAYS` when unset, non-numeric, or
 * negative. Exported for direct testing.
 */
export function resolveWeatherSnapshotRetentionDays(raw: string | undefined): number {
    if (raw === undefined) return DEFAULT_WEATHER_SNAPSHOT_RETENTION_DAYS;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_WEATHER_SNAPSHOT_RETENTION_DAYS;
}

/**
 * Provenance + request parameters for a single fetch, paired with the weather
 * payload to persist.
 */
export type RecordWeatherSnapshotInput = {
    /** The zone the forecast was fetched for. */
    zoneId: string;
    /** Latitude the forecast was requested at. */
    latitude: number;
    /** Longitude the forecast was requested at. */
    longitude: number;
    /** IANA timezone the forecast was requested in. */
    timezone: string;
    /** When the fetch happened. */
    fetchedAt: Date;
    /** The parsed Open-Meteo payload (daily + hourly series). */
    weather: WeatherData;
};

/**
 * Domain interface for the append-only `weather_snapshots` log and its daily /
 * hourly child series.
 */
export interface WeatherSnapshotsRepository {
    /**
     * Persists one snapshot (parent row + daily/hourly children) atomically,
     * then prunes snapshots older than the retention window. Returns the new
     * snapshot's id so a caller can tie a plan back to the forecast that drove
     * it. Best-effort by contract — callers treat a rejection as non-fatal.
     */
    record(input: RecordWeatherSnapshotInput): Promise<string>;
}

/**
 * Builds the production `WeatherSnapshotsRepository` bound to a Drizzle client.
 * `retentionDays` defaults to the resolved `WEATHER_SNAPSHOT_RETENTION_DAYS`
 * env value; pass an explicit value in tests.
 */
export function createWeatherSnapshotsRepository(
    db: Database,
    retentionDays: number = resolveWeatherSnapshotRetentionDays(process.env.WEATHER_SNAPSHOT_RETENTION_DAYS),
): WeatherSnapshotsRepository {
    return {
        record: async ({ zoneId, latitude, longitude, timezone, fetchedAt, weather }) => {
            return db.transaction(async (tx) => {
                const inserted = await tx
                    .insert(weatherSnapshots)
                    .values({ zoneId, latitude, longitude, timezone, fetchedAt })
                    .returning({ id: weatherSnapshots.id });
                const snapshotId = inserted[0]!.id;

                const dailyRows = weather.daily.map(day => ({
                    snapshotId,
                    date: day.date.format('YYYY-MM-DD'),
                    sunriseAt: day.sunrise?.toDate() ?? null,
                    sunsetAt: day.sunset?.toDate() ?? null,
                    precipitationMm: day.rainfallMm ?? null,
                    et0MmPerDay: day.evapotranspirationMmPerDay ?? null,
                }));
                if (dailyRows.length > 0) {
                    await tx.insert(weatherDailySnapshots).values(dailyRows);
                }

                const hourlyRows = weather.hourly.map(hour => ({
                    snapshotId,
                    time: hour.time.toDate(),
                    precipitationMm: hour.precipitationMm,
                    et0Mm: hour.evapotranspirationMm,
                }));
                if (hourlyRows.length > 0) {
                    await tx.insert(weatherHourlySnapshots).values(hourlyRows);
                }

                // Prune the append-only log to the retention window. Children
                // cascade-delete with their parent. A retention of 0 disables
                // pruning entirely (keep everything).
                if (retentionDays > 0) {
                    const cutoff = dayjs(fetchedAt).subtract(retentionDays, 'day').toDate();
                    await tx.delete(weatherSnapshots).where(lt(weatherSnapshots.fetchedAt, cutoff));
                }

                console.log(`weather-snapshots: recorded snapshot ${snapshotId} for zone ${zoneId} (${dailyRows.length} daily, ${hourlyRows.length} hourly rows).`);
                return snapshotId;
            });
        },
    };
}
