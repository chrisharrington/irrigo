import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, it, expect } from 'bun:test';
import { readJournalFile } from './verify-migrations';

const DRIZZLE_DIR = path.resolve(import.meta.dir, '..', 'drizzle');
const MIGRATION_TAG = '0018_backfill_maintenance_end_by_sunrise';

/**
 * APP-93: the Maintenance schedule's `end_by_sunrise` shipped as `null` in
 * existing databases because the seed's ON CONFLICT set never refreshes it
 * (preserving operator edits). Migration 0018 is a one-shot, idempotent
 * backfill that converges those rows on `true`. There is no live-DB harness
 * in this suite, so these guard the migration artifact itself: the SQL is
 * correct and the journal links it as the newest on-disk migration.
 */
describe('0018 backfill maintenance end_by_sunrise', () => {
    it('ships an idempotent UPDATE scoped to the maintenance slug', async () => {
        const raw = await readFile(path.join(DRIZZLE_DIR, `${MIGRATION_TAG}.sql`), 'utf8');
        const sql = raw.replace(/\s+/g, ' ').trim().toLowerCase();

        expect(sql).toContain('update "schedules"');
        expect(sql).toContain('set "end_by_sunrise" = true');
        expect(sql).toContain(`where "slug" = 'maintenance'`);
        // IS NULL guard keeps the backfill idempotent and avoids clobbering a
        // deliberate operator `false`.
        expect(sql).toContain('"end_by_sunrise" is null');
    });

    it('is registered in the journal as the newest migration', async () => {
        const journal = await readJournalFile(DRIZZLE_DIR);

        const entry = journal.entries.find(e => e.tag === MIGRATION_TAG);
        expect(entry).toBeDefined();

        const newestWhen = journal.entries.reduce((max, e) => (e.when > max ? e.when : max), 0);
        expect(entry!.when).toBe(newestWhen);
    });
});
