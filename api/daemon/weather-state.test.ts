import { describe, it, expect } from 'bun:test';
import {
    isWeatherStale,
    markWeatherFetchSuccessful,
    WEATHER_STALE_THRESHOLD_MS,
    type WeatherStateReaderDb,
    type WeatherStateWriterDb,
} from './weather-state';

const NOW = new Date('2026-05-20T12:00:00.000Z');

type WriterCall = {
    values: Record<string, unknown>;
    conflictTarget: unknown;
    conflictSet: Record<string, unknown>;
};

function createWriterStub(): { db: WeatherStateWriterDb; calls: WriterCall[] } {
    const calls: WriterCall[] = [];
    const db: WeatherStateWriterDb = {
        insert: (_table) => ({
            values: (row) => ({
                onConflictDoUpdate: async (config) => {
                    calls.push({ values: row, conflictTarget: config.target, conflictSet: config.set });
                },
            }),
        }),
    };
    return { db, calls };
}

function createReaderStub(rows: ReadonlyArray<{ lastSuccessfulFetchAt: Date | null }>): WeatherStateReaderDb {
    return {
        select: (_cols) => ({
            from: (_table) => ({
                where: (_cond) => ({
                    limit: (_n) => Promise.resolve([...rows]),
                }),
            }),
        }),
    };
}

describe('markWeatherFetchSuccessful', () => {
    it('upserts the singleton row with the supplied timestamp', async () => {
        const { db, calls } = createWriterStub();

        await markWeatherFetchSuccessful(db, NOW);

        expect(calls).toHaveLength(1);
        expect(calls[0]!.values).toEqual({
            id: 'singleton',
            lastSuccessfulFetchAt: NOW,
        });
    });

    it('targets the singleton row id on conflict and refreshes the timestamp', async () => {
        const { db, calls } = createWriterStub();

        await markWeatherFetchSuccessful(db, NOW);

        expect(calls[0]!.conflictTarget).toBeDefined();
        expect('lastSuccessfulFetchAt' in calls[0]!.conflictSet).toBe(true);
    });

    it('records every invocation independently — repeated calls each issue an upsert', async () => {
        const { db, calls } = createWriterStub();

        await markWeatherFetchSuccessful(db, NOW);
        await markWeatherFetchSuccessful(db, new Date(NOW.getTime() + 60_000));

        expect(calls).toHaveLength(2);
    });
});

describe('isWeatherStale', () => {
    it('returns true when no row exists yet (never fetched successfully)', async () => {
        const db = createReaderStub([]);

        const result = await isWeatherStale(db, NOW);

        expect(result).toBe(true);
    });

    it('returns true when the row exists but lastSuccessfulFetchAt is null', async () => {
        const db = createReaderStub([{ lastSuccessfulFetchAt: null }]);

        const result = await isWeatherStale(db, NOW);

        expect(result).toBe(true);
    });

    it('returns true when the last fetch is older than the default 24h threshold', async () => {
        const stale = new Date(NOW.getTime() - (WEATHER_STALE_THRESHOLD_MS + 60_000));
        const db = createReaderStub([{ lastSuccessfulFetchAt: stale }]);

        const result = await isWeatherStale(db, NOW);

        expect(result).toBe(true);
    });

    it('returns false when the last fetch is exactly at the threshold boundary (not stale yet)', async () => {
        const atBoundary = new Date(NOW.getTime() - WEATHER_STALE_THRESHOLD_MS);
        const db = createReaderStub([{ lastSuccessfulFetchAt: atBoundary }]);

        const result = await isWeatherStale(db, NOW);

        expect(result).toBe(false);
    });

    it('returns false when the last fetch is well within the threshold', async () => {
        const fresh = new Date(NOW.getTime() - 60_000);
        const db = createReaderStub([{ lastSuccessfulFetchAt: fresh }]);

        const result = await isWeatherStale(db, NOW);

        expect(result).toBe(false);
    });

    it('honours an explicit threshold override', async () => {
        // 5 minutes ago, threshold 1 minute → stale.
        const recent = new Date(NOW.getTime() - 5 * 60_000);
        const db = createReaderStub([{ lastSuccessfulFetchAt: recent }]);

        const result = await isWeatherStale(db, NOW, 60_000);

        expect(result).toBe(true);
    });
});
