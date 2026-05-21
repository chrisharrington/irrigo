import { describe, expect, it } from 'bun:test';
import type { Database } from '@/db';
import {
    createWeatherStateRepository,
    WEATHER_STALE_THRESHOLD_MS,
    WEATHER_STATE_SINGLETON_ID,
} from '.';

const NOW = new Date('2026-05-20T12:00:00.000Z');

type WriterCall = {
    values: Record<string, unknown>;
    conflictTarget: unknown;
    conflictSet: Record<string, unknown>;
};

function stubWriter(): { db: Database; calls: WriterCall[] } {
    const calls: WriterCall[] = [];
    const db = {
        insert: () => ({
            values: (row: Record<string, unknown>) => ({
                onConflictDoUpdate: async ({ target, set }: { target: unknown; set: Record<string, unknown> }) => {
                    calls.push({ values: row, conflictTarget: target, conflictSet: set });
                },
            }),
        }),
        select: () => ({
            from: () => ({
                where: () => ({
                    limit: async () => [],
                }),
            }),
        }),
    } as unknown as Database;
    return { db, calls };
}

function stubReader(rows: ReadonlyArray<{ lastSuccessfulFetchAt: Date | null }>): Database {
    return {
        select: () => ({
            from: () => ({
                where: () => ({
                    limit: async () => [...rows],
                }),
            }),
        }),
        insert: () => ({
            values: () => ({
                onConflictDoUpdate: async () => undefined,
            }),
        }),
    } as unknown as Database;
}

describe('createWeatherStateRepository.markFetchSuccessful', () => {
    it('upserts the singleton row with the supplied timestamp', async () => {
        const { db, calls } = stubWriter();
        const repo = createWeatherStateRepository(db);

        await repo.markFetchSuccessful(NOW);

        expect(calls).toHaveLength(1);
        expect(calls[0]!.values).toEqual({
            id: WEATHER_STATE_SINGLETON_ID,
            lastSuccessfulFetchAt: NOW,
        });
    });

    it('targets the singleton row id on conflict and refreshes the timestamp', async () => {
        const { db, calls } = stubWriter();
        const repo = createWeatherStateRepository(db);

        await repo.markFetchSuccessful(NOW);

        expect(calls[0]!.conflictTarget).toBeDefined();
        expect('lastSuccessfulFetchAt' in calls[0]!.conflictSet).toBe(true);
    });

    it('records every invocation independently — repeated calls each issue an upsert', async () => {
        const { db, calls } = stubWriter();
        const repo = createWeatherStateRepository(db);

        await repo.markFetchSuccessful(NOW);
        await repo.markFetchSuccessful(new Date(NOW.getTime() + 60_000));

        expect(calls).toHaveLength(2);
    });
});

describe('createWeatherStateRepository.isStale', () => {
    it('returns true when no row exists yet (never fetched successfully)', async () => {
        const repo = createWeatherStateRepository(stubReader([]));

        const result = await repo.isStale(NOW);

        expect(result).toBe(true);
    });

    it('returns true when the row exists but lastSuccessfulFetchAt is null', async () => {
        const repo = createWeatherStateRepository(stubReader([{ lastSuccessfulFetchAt: null }]));

        const result = await repo.isStale(NOW);

        expect(result).toBe(true);
    });

    it('returns true when the last fetch is older than the default 24h threshold', async () => {
        const stale = new Date(NOW.getTime() - (WEATHER_STALE_THRESHOLD_MS + 60_000));
        const repo = createWeatherStateRepository(stubReader([{ lastSuccessfulFetchAt: stale }]));

        const result = await repo.isStale(NOW);

        expect(result).toBe(true);
    });

    it('returns false when the last fetch is exactly at the threshold boundary (not stale yet)', async () => {
        const atBoundary = new Date(NOW.getTime() - WEATHER_STALE_THRESHOLD_MS);
        const repo = createWeatherStateRepository(stubReader([{ lastSuccessfulFetchAt: atBoundary }]));

        const result = await repo.isStale(NOW);

        expect(result).toBe(false);
    });

    it('returns false when the last fetch is well within the threshold', async () => {
        const fresh = new Date(NOW.getTime() - 60_000);
        const repo = createWeatherStateRepository(stubReader([{ lastSuccessfulFetchAt: fresh }]));

        const result = await repo.isStale(NOW);

        expect(result).toBe(false);
    });

    it('honours an explicit threshold override', async () => {
        const recent = new Date(NOW.getTime() - 5 * 60_000);
        const repo = createWeatherStateRepository(stubReader([{ lastSuccessfulFetchAt: recent }]));

        const result = await repo.isStale(NOW, 60_000);

        expect(result).toBe(true);
    });
});
