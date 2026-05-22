import { eq, sql } from 'drizzle-orm';
import type { Database } from '@/db';
import { WEATHER_STATE_SINGLETON_ID, weatherState } from '@/db/schema';

export { WEATHER_STATE_SINGLETON_ID };

/**
 * Cutoff for the `weather-stale` alert. Re-plans run once a day, so anything
 * older than 24 hours means today's plan was generated against stale (or
 * absent) ET₀.
 */
export const WEATHER_STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

/**
 * Domain interface for the singleton `weather_state` row. The repo doesn't
 * expose the raw timestamp — services only need to know whether weather is
 * stale, and to stamp a successful fetch.
 */
export interface WeatherStateRepository {
    /** Upserts the singleton row's `last_successful_fetch_at` to `now`. */
    markFetchSuccessful(now: Date): Promise<void>;

    /**
     * Returns `true` when no row exists yet, when the timestamp is null, or
     * when `now - timestamp > threshold`. Threshold defaults to
     * `WEATHER_STALE_THRESHOLD_MS` (24h).
     */
    isStale(now: Date, threshold?: number): Promise<boolean>;
}

/**
 * Builds the production `WeatherStateRepository` bound to a Drizzle client.
 */
export function createWeatherStateRepository(db: Database): WeatherStateRepository {
    return {
        markFetchSuccessful: async (now) => {
            await db
                .insert(weatherState)
                .values({ id: WEATHER_STATE_SINGLETON_ID, lastSuccessfulFetchAt: now })
                .onConflictDoUpdate({
                    target: weatherState.id,
                    set: { lastSuccessfulFetchAt: sql`excluded.last_successful_fetch_at` },
                });
        },
        isStale: async (now, threshold = WEATHER_STALE_THRESHOLD_MS) => {
            const rows = await db
                .select({ lastSuccessfulFetchAt: weatherState.lastSuccessfulFetchAt })
                .from(weatherState)
                .where(eq(weatherState.id, WEATHER_STATE_SINGLETON_ID))
                .limit(1);

            const row = rows[0];
            if (!row || row.lastSuccessfulFetchAt === null) return true;
            return now.getTime() - row.lastSuccessfulFetchAt.getTime() > threshold;
        },
    };
}
