import { afterAll, beforeAll, describe, it, expect } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
    MIGRATIONS_TABLE_MISSING,
    queryLatestMigrationViaDrizzle,
    readJournalFile,
    verifyMigrations,
    type JournalEntry,
    type LatestMigrationRow,
    type MigrationsTableMissing,
} from './verify-migrations';

function buildDeps(overrides: {
    queryLatestMigration?: () => Promise<LatestMigrationRow | null | MigrationsTableMissing>;
    journal?: { entries: JournalEntry[] };
}) {
    return {
        queryLatestMigration: overrides.queryLatestMigration ?? (async () => null),
        readJournal: async () => overrides.journal ?? { entries: [] as JournalEntry[] },
    };
}

describe('verifyMigrations', () => {
    it('returns ok:true when the DB createdAt equals the journal\'s latest when', async () => {
        const result = await verifyMigrations(buildDeps({
            queryLatestMigration: async () => ({ hash: 'h2', createdAt: 200 }),
            journal: { entries: [
                { idx: 0, tag: '0000_first', when: 100 },
                { idx: 1, tag: '0001_second', when: 200 },
            ] },
        }));

        expect(result).toEqual({ ok: true });
    });

    it('returns ok:true when the DB createdAt is greater than the journal\'s latest when', async () => {
        const result = await verifyMigrations(buildDeps({
            queryLatestMigration: async () => ({ hash: 'h-newer', createdAt: 500 }),
            journal: { entries: [{ idx: 0, tag: '0000_first', when: 100 }] },
        }));

        expect(result).toEqual({ ok: true });
    });

    it('returns ok:false with the not-migrated message when the migrations table is missing', async () => {
        const result = await verifyMigrations(buildDeps({
            queryLatestMigration: async () => MIGRATIONS_TABLE_MISSING,
            journal: { entries: [{ idx: 0, tag: '0000_first', when: 100 }] },
        }));

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.message).toContain('Database is not migrated');
            expect(result.message).toContain('bun run db:migrate');
        }
    });

    it('returns ok:false with the behind-codebase message when the table exists but has no rows', async () => {
        const result = await verifyMigrations(buildDeps({
            queryLatestMigration: async () => null,
            journal: { entries: [{ idx: 0, tag: '0000_first', when: 100 }] },
        }));

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.message).toContain('behind the codebase');
            expect(result.message).toContain('0000_first');
            expect(result.message).toContain('latest applied: none');
        }
    });

    it('returns ok:false naming the latest disk migration when the DB is behind', async () => {
        const result = await verifyMigrations(buildDeps({
            queryLatestMigration: async () => ({ hash: 'h0', createdAt: 100 }),
            journal: { entries: [
                { idx: 0, tag: '0000_first', when: 100 },
                { idx: 1, tag: '0001_added_source_column', when: 250 },
            ] },
        }));

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.message).toContain('behind the codebase');
            expect(result.message).toContain('0001_added_source_column');
            expect(result.message).toContain(new Date(100).toISOString());
        }
    });

    it('returns ok:true when both the DB and the journal are empty', async () => {
        const result = await verifyMigrations(buildDeps({
            queryLatestMigration: async () => null,
            journal: { entries: [] },
        }));

        expect(result).toEqual({ ok: true });
    });
});

describe('queryLatestMigrationViaDrizzle', () => {
    it('returns the mapped row when the executor returns a non-empty result', async () => {
        const result = await queryLatestMigrationViaDrizzle(async () => ([
            { hash: 'abc123', created_at: 1_777_945_136_892 },
        ]));

        expect(result).toEqual({ hash: 'abc123', createdAt: 1_777_945_136_892 });
    });

    it('coerces a bigint created_at into a number', async () => {
        const result = await queryLatestMigrationViaDrizzle(async () => ([
            { hash: 'abc', created_at: 1_777_945_136_892n },
        ]));

        expect(result).toEqual({ hash: 'abc', createdAt: 1_777_945_136_892 });
    });

    it('returns null when the executor returns an empty array', async () => {
        const result = await queryLatestMigrationViaDrizzle(async () => []);

        expect(result).toBeNull();
    });

    it('also accepts a node-postgres-style { rows } envelope', async () => {
        const result = await queryLatestMigrationViaDrizzle(async () => ({
            rows: [{ hash: 'h', created_at: 50 }],
        }));

        expect(result).toEqual({ hash: 'h', createdAt: 50 });
    });

    it('returns table-missing when the executor throws with code 42P01 (undefined_table)', async () => {
        const result = await queryLatestMigrationViaDrizzle(async () => {
            const err = Object.assign(new Error('relation does not exist'), { code: '42P01' });
            throw err;
        });

        expect(result).toBe(MIGRATIONS_TABLE_MISSING);
    });

    it('returns table-missing when the executor throws with code 3F000 (invalid_schema_name)', async () => {
        const result = await queryLatestMigrationViaDrizzle(async () => {
            const err = Object.assign(new Error('schema "drizzle" does not exist'), { code: '3F000' });
            throw err;
        });

        expect(result).toBe(MIGRATIONS_TABLE_MISSING);
    });

    it('propagates errors with other postgres error codes', async () => {
        await expect(queryLatestMigrationViaDrizzle(async () => {
            throw Object.assign(new Error('connection refused'), { code: '08006' });
        })).rejects.toThrow('connection refused');
    });
});

describe('readJournalFile', () => {
    const tmpDir = path.join('/tmp', `irrigo-journal-test-${Date.now()}`);

    beforeAll(async () => {
        await mkdir(path.join(tmpDir, 'meta'), { recursive: true });
    });

    afterAll(async () => {
        await rm(tmpDir, { recursive: true, force: true });
    });

    it('parses the on-disk journal for the api/drizzle directory', async () => {
        const drizzleDir = path.resolve(import.meta.dir, '..', 'drizzle');

        const journal = await readJournalFile(drizzleDir);

        expect(journal.entries.length).toBeGreaterThan(0);
        for (const entry of journal.entries) {
            expect(typeof entry.idx).toBe('number');
            expect(typeof entry.tag).toBe('string');
            expect(typeof entry.when).toBe('number');
        }
    });

    it('drops malformed entries while keeping well-formed ones', async () => {
        await writeFile(path.join(tmpDir, 'meta', '_journal.json'), JSON.stringify({
            version: '7',
            entries: [
                { idx: 0, tag: 'good', when: 100 },
                { idx: 'bad', tag: 'wrong-types', when: 200 },
                { idx: 1, tag: 'also-good', when: 300 },
            ],
        }));

        const journal = await readJournalFile(tmpDir);

        expect(journal.entries.map(e => e.tag)).toEqual(['good', 'also-good']);
    });

    it('throws when the journal file is missing', async () => {
        await expect(readJournalFile(path.join(tmpDir, 'does-not-exist'))).rejects.toThrow();
    });
});
