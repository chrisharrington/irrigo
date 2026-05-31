import { describe, expect, it } from 'bun:test';
import dayjs from 'dayjs';
import type { Database } from '@/db';
import { weatherDailySnapshots, weatherHourlySnapshots, weatherSnapshots } from '@/db/schema';
import type { WeatherData } from '@/models';
import {
    createWeatherSnapshotsRepository,
    DEFAULT_WEATHER_SNAPSHOT_RETENTION_DAYS,
    resolveWeatherSnapshotRetentionDays,
} from '.';

type InsertCall = { table: unknown; rows: unknown };
type DeleteCall = { table: unknown; condition: unknown };

const SNAPSHOT_ID = 'snapshot-001';

/**
 * Recording-stub Drizzle client. `insert().values()` is both awaitable (child
 * inserts) and `.returning()`-able (parent insert); `delete().where()` records
 * the prune. `transaction` runs the callback against the same stub.
 */
function makeStub() {
    const inserts: InsertCall[] = [];
    const deletes: DeleteCall[] = [];
    const db = {
        transaction: async <T>(cb: (tx: unknown) => Promise<T>): Promise<T> => cb(db),
        insert: (table: unknown) => ({
            values: (rows: unknown) => {
                inserts.push({ table, rows });
                return {
                    returning: async () => [{ id: SNAPSHOT_ID }],
                    then: (resolve: (v: unknown) => void) => resolve(undefined),
                };
            },
        }),
        delete: (table: unknown) => ({
            where: (condition: unknown) => {
                deletes.push({ table, condition });
                return Promise.resolve();
            },
        }),
    } as unknown as Database;
    return { db, inserts, deletes };
}

/** Walks a Drizzle condition tree and returns the first Date value it carries. */
function findDate(node: unknown, seen = new WeakSet<object>()): Date | undefined {
    if (node instanceof Date) return node;
    if (typeof node !== 'object' || node === null) return undefined;
    if (seen.has(node)) return undefined;
    seen.add(node);
    for (const value of Object.values(node as Record<string, unknown>)) {
        const found = findDate(value, seen);
        if (found) return found;
    }
    return undefined;
}

const TZ = 'America/Edmonton';
const FETCHED_AT = new Date('2026-05-30T20:00:00.000Z');

function buildWeather(): WeatherData {
    return {
        daily: [
            {
                date: dayjs('2026-05-30'),
                sunrise: dayjs('2026-05-30T05:41:00.000Z'),
                sunset: dayjs('2026-05-30T21:24:00.000Z'),
                rainfallMm: 8.0,
                evapotranspirationMmPerDay: 4.2,
            },
            {
                date: dayjs('2026-05-31'),
                sunrise: dayjs('2026-05-31T05:40:00.000Z'),
                sunset: dayjs('2026-05-31T21:25:00.000Z'),
                rainfallMm: 0,
                evapotranspirationMmPerDay: 3.8,
            },
        ],
        hourly: [
            { time: dayjs('2026-05-30T00:00:00.000Z'), precipitationMm: 0.5, evapotranspirationMm: 0.1 },
            { time: dayjs('2026-05-30T01:00:00.000Z'), precipitationMm: 0.0, evapotranspirationMm: 0.12 },
        ],
    };
}

const baseInput = () => ({
    zoneId: 'zone-001',
    latitude: 51.0447,
    longitude: -114.0719,
    timezone: TZ,
    fetchedAt: FETCHED_AT,
    weather: buildWeather(),
});

describe('createWeatherSnapshotsRepository', () => {
    it('inserts the parent snapshot tagged with zone, coords, timezone, and fetch time', async () => {
        const { db, inserts } = makeStub();
        const repo = createWeatherSnapshotsRepository(db, 28);

        await repo.record(baseInput());

        const parent = inserts.find(c => c.table === weatherSnapshots);
        expect(parent).toBeDefined();
        expect(parent!.rows).toMatchObject({
            zoneId: 'zone-001',
            latitude: 51.0447,
            longitude: -114.0719,
            timezone: TZ,
            fetchedAt: FETCHED_AT,
        });
    });

    it('returns the new snapshot id so a plan can reference it', async () => {
        const { db } = makeStub();
        const repo = createWeatherSnapshotsRepository(db, 28);

        const id = await repo.record(baseInput());

        expect(id).toBe(SNAPSHOT_ID);
    });

    it('inserts the daily series keyed to the parent, mapping fields and nulls', async () => {
        const { db, inserts } = makeStub();
        const repo = createWeatherSnapshotsRepository(db, 28);

        await repo.record(baseInput());

        const dailyInsert = inserts.find(c => c.table === weatherDailySnapshots);
        expect(dailyInsert).toBeDefined();
        const rows = dailyInsert!.rows as Array<Record<string, unknown>>;
        expect(rows).toHaveLength(2);
        expect(rows[0]).toMatchObject({
            snapshotId: SNAPSHOT_ID,
            date: '2026-05-30',
            precipitationMm: 8.0,
            et0MmPerDay: 4.2,
        });
        expect(rows[0]!['sunriseAt']).toBeInstanceOf(Date);
        expect(rows[0]!['sunsetAt']).toBeInstanceOf(Date);
    });

    it('inserts the hourly series keyed to the parent', async () => {
        const { db, inserts } = makeStub();
        const repo = createWeatherSnapshotsRepository(db, 28);

        await repo.record(baseInput());

        const hourlyInsert = inserts.find(c => c.table === weatherHourlySnapshots);
        expect(hourlyInsert).toBeDefined();
        const rows = hourlyInsert!.rows as Array<Record<string, unknown>>;
        expect(rows).toHaveLength(2);
        expect(rows[0]).toMatchObject({ snapshotId: SNAPSHOT_ID, precipitationMm: 0.5, et0Mm: 0.1 });
        expect(rows[0]!['time']).toBeInstanceOf(Date);
    });

    it('prunes snapshots older than the retention window, measured from the fetch time', async () => {
        const { db, deletes } = makeStub();
        const repo = createWeatherSnapshotsRepository(db, 28);

        await repo.record(baseInput());

        const prune = deletes.find(c => c.table === weatherSnapshots);
        expect(prune).toBeDefined();
        const cutoff = findDate(prune!.condition);
        expect(cutoff).toEqual(dayjs(FETCHED_AT).subtract(28, 'day').toDate());
    });

    it('does not prune when retention is 0 (keep everything)', async () => {
        const { db, deletes } = makeStub();
        const repo = createWeatherSnapshotsRepository(db, 0);

        await repo.record(baseInput());

        expect(deletes).toHaveLength(0);
    });

    it('skips child inserts when the daily and hourly series are empty', async () => {
        const { db, inserts } = makeStub();
        const repo = createWeatherSnapshotsRepository(db, 28);

        await repo.record({ ...baseInput(), weather: { daily: [], hourly: [] } });

        expect(inserts.find(c => c.table === weatherDailySnapshots)).toBeUndefined();
        expect(inserts.find(c => c.table === weatherHourlySnapshots)).toBeUndefined();
        expect(inserts.find(c => c.table === weatherSnapshots)).toBeDefined();
    });
});

describe('resolveWeatherSnapshotRetentionDays', () => {
    it('falls back to the default when unset', () => {
        expect(resolveWeatherSnapshotRetentionDays(undefined)).toBe(DEFAULT_WEATHER_SNAPSHOT_RETENTION_DAYS);
    });

    it('parses a positive integer', () => {
        expect(resolveWeatherSnapshotRetentionDays('14')).toBe(14);
    });

    it('accepts 0 to disable pruning', () => {
        expect(resolveWeatherSnapshotRetentionDays('0')).toBe(0);
    });

    it('falls back to the default on non-numeric input', () => {
        expect(resolveWeatherSnapshotRetentionDays('forever')).toBe(DEFAULT_WEATHER_SNAPSHOT_RETENTION_DAYS);
    });

    it('falls back to the default on a negative value', () => {
        expect(resolveWeatherSnapshotRetentionDays('-5')).toBe(DEFAULT_WEATHER_SNAPSHOT_RETENTION_DAYS);
    });
});
