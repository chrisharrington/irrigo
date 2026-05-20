import { eq, sql } from 'drizzle-orm';
import { WEATHER_STATE_SINGLETON_ID, weatherState } from '@/db/schema';

/**
 * Cutoff for the `weather-stale` alert. Re-plans run once a day, so anything
 * older than 24 hours means today's plan was generated against stale (or
 * absent) ET₀.
 */
export const WEATHER_STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

/**
 * Minimal db interface used by the writer. Mirrors the seed-script pattern —
 * production passes Drizzle directly, tests pass a recording stub.
 */
export type WeatherStateWriterDb = {
    insert: (table: typeof weatherState) => {
        values: (row: Record<string, unknown>) => {
            onConflictDoUpdate: (config: {
                target: unknown;
                set: Record<string, unknown>;
            }) => Promise<unknown>;
        };
    };
};

/**
 * Minimal db interface used by the reader. Returns the singleton row's
 * timestamp (or an empty array when no row exists yet).
 */
export type WeatherStateReaderDb = {
    select: (cols: { lastSuccessfulFetchAt: typeof weatherState.lastSuccessfulFetchAt }) => {
        from: (table: typeof weatherState) => {
            where: (cond: unknown) => {
                limit: (n: number) => Promise<Array<{ lastSuccessfulFetchAt: Date | null }>>;
            };
        };
    };
};

/**
 * Composite for callers that need both surfaces.
 */
export type WeatherStateDb = WeatherStateWriterDb & WeatherStateReaderDb;

/**
 * Stamps the singleton row with `now` so the next staleness check passes.
 * Upserts on conflict — the row is created lazily the first time a fetch
 * succeeds, and updates in place on every subsequent success.
 *
 * @param db - Drizzle client (or compatible stub).
 * @param now - Wall-clock timestamp to record. Injectable so callers can drive
 *   the clock under test.
 */
export async function markWeatherFetchSuccessful(db: WeatherStateWriterDb, now: Date): Promise<void> {
    await db
        .insert(weatherState)
        .values({ id: WEATHER_STATE_SINGLETON_ID, lastSuccessfulFetchAt: now })
        .onConflictDoUpdate({
            target: weatherState.id,
            set: { lastSuccessfulFetchAt: sql`excluded.last_successful_fetch_at` },
        });
}

/**
 * Returns `true` when the planner should be treated as running on stale
 * weather: either the singleton row doesn't exist yet (no fetch has ever
 * succeeded) or its timestamp is older than `threshold` milliseconds.
 *
 * @param db - Drizzle client (or compatible stub).
 * @param now - Reference timestamp. Use the daemon's clock so tests can
 *   advance time deterministically.
 * @param threshold - Milliseconds before a fetch is considered stale.
 *   Defaults to `WEATHER_STALE_THRESHOLD_MS`.
 */
export async function isWeatherStale(
    db: WeatherStateReaderDb,
    now: Date,
    threshold: number = WEATHER_STALE_THRESHOLD_MS,
): Promise<boolean> {
    const rows = await db
        .select({ lastSuccessfulFetchAt: weatherState.lastSuccessfulFetchAt })
        .from(weatherState)
        .where(eq(weatherState.id, WEATHER_STATE_SINGLETON_ID))
        .limit(1);

    const row = rows[0];
    if (!row || row.lastSuccessfulFetchAt === null) return true;
    return now.getTime() - row.lastSuccessfulFetchAt.getTime() > threshold;
}
