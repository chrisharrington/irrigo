import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { sql, type SQL } from 'drizzle-orm';

/**
 * Outcome of a startup migration check. `ok: false` carries a human-readable
 * message ready for the caller to log and exit non-zero with.
 */
export type VerifyMigrationsResult = { ok: true } | { ok: false; message: string };

/**
 * Snapshot of the latest applied migration as recorded in
 * `drizzle.__drizzle_migrations`. `createdAt` is the epoch-ms value that
 * drizzle-orm wrote at apply time — identical to the journal's `when`.
 */
export type LatestMigrationRow = { hash: string; createdAt: number };

/**
 * One entry in `api/drizzle/meta/_journal.json`. Drizzle-kit writes these in
 * apply order; `when` is epoch-ms.
 */
export type JournalEntry = { idx: number; tag: string; when: number };

/**
 * Sentinel returned by `queryLatestMigration` when the migrations table or
 * its enclosing schema is missing — the case the verifier translates into
 * the "Database is not migrated" failure mode.
 */
export const MIGRATIONS_TABLE_MISSING = 'table-missing' as const;
export type MigrationsTableMissing = typeof MIGRATIONS_TABLE_MISSING;

/**
 * Collaborators injected at construction so the verifier is fully testable
 * without touching either Postgres or the file system.
 */
export type VerifyMigrationsDeps = {
    queryLatestMigration: () => Promise<LatestMigrationRow | null | MigrationsTableMissing>;
    readJournal: () => Promise<{ entries: JournalEntry[] }>;
};

/**
 * Compares the latest migration applied in the database against the latest
 * migration committed to the codebase. Returns `ok: true` when the DB is at
 * or ahead of the codebase, otherwise an actionable `ok: false` message.
 *
 * This function is pure over its deps — see `queryLatestMigrationViaDrizzle`
 * and `readJournalFile` for the production wiring.
 */
export async function verifyMigrations(deps: VerifyMigrationsDeps): Promise<VerifyMigrationsResult> {
    const latestApplied = await deps.queryLatestMigration();
    if (latestApplied === MIGRATIONS_TABLE_MISSING) {
        return {
            ok: false,
            message: 'Database is not migrated. Run `bun run db:migrate` before starting the api container.',
        };
    }

    const journal = await deps.readJournal();
    const latestOnDisk = journal.entries.reduce<JournalEntry | null>((max, entry) => {
        if (max === null || entry.when > max.when) return entry;
        return max;
    }, null);

    if (latestOnDisk === null) {
        return { ok: true };
    }

    if (latestApplied === null || latestApplied.createdAt < latestOnDisk.when) {
        const appliedDescription = latestApplied === null
            ? 'none'
            : new Date(latestApplied.createdAt).toISOString();
        return {
            ok: false,
            message: `Database schema is behind the codebase (latest applied: ${appliedDescription}; latest on disk: ${latestOnDisk.tag}). Run \`bun run db:migrate\`.`,
        };
    }

    return { ok: true };
}

/**
 * Executes the migration-table query through a caller-supplied executor and
 * maps Postgres "table/schema does not exist" errors to the
 * `'table-missing'` sentinel. The executor abstraction lets the production
 * wiring use `db.execute` while tests pass deterministic stubs.
 */
export async function queryLatestMigrationViaDrizzle(
    executor: (query: SQL) => Promise<unknown>,
): Promise<LatestMigrationRow | null | MigrationsTableMissing> {
    try {
        const result = await executor(
            sql`select hash, created_at from drizzle.__drizzle_migrations order by created_at desc limit 1`,
        );
        const rows = extractRows(result);
        const row = rows[0];
        if (!row) return null;
        const hash = row['hash'];
        const createdAt = row['created_at'];
        if (typeof hash !== 'string') return null;
        const createdAtNumber = typeof createdAt === 'bigint' ? Number(createdAt) : Number(createdAt);
        if (!Number.isFinite(createdAtNumber)) return null;
        return { hash, createdAt: createdAtNumber };
    } catch (err) {
        if (isPostgresMissingObjectError(err)) return MIGRATIONS_TABLE_MISSING;
        throw err;
    }
}

/**
 * Reads `_journal.json` from a drizzle output directory. The file is the
 * source of truth for what migrations exist on disk.
 *
 * @param drizzleDir - Absolute path to the directory containing the `meta/`
 *   subfolder (i.e. `api/drizzle` in this project).
 */
export async function readJournalFile(drizzleDir: string): Promise<{ entries: JournalEntry[] }> {
    const filePath = path.join(drizzleDir, 'meta', '_journal.json');
    const raw = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as { entries?: unknown };
    const entries = Array.isArray(parsed.entries) ? parsed.entries : [];
    return {
        entries: entries.flatMap((entry): JournalEntry[] => {
            if (entry === null || typeof entry !== 'object') return [];
            const e = entry as Record<string, unknown>;
            const idx = typeof e['idx'] === 'number' ? e['idx'] : null;
            const tag = typeof e['tag'] === 'string' ? e['tag'] : null;
            const when = typeof e['when'] === 'number' ? e['when'] : null;
            if (idx === null || tag === null || when === null) return [];
            return [{ idx, tag, when }];
        }),
    };
}

function extractRows(result: unknown): ReadonlyArray<Record<string, unknown>> {
    // postgres-js returns an array-like RowList; node-postgres returns { rows: [] }.
    if (Array.isArray(result)) return result as ReadonlyArray<Record<string, unknown>>;
    if (result && typeof result === 'object' && 'rows' in result) {
        const rows = (result as { rows: unknown }).rows;
        if (Array.isArray(rows)) return rows as ReadonlyArray<Record<string, unknown>>;
    }
    return [];
}

function isPostgresMissingObjectError(err: unknown): boolean {
    if (!err || typeof err !== 'object') return false;
    const code = (err as { code?: unknown }).code;
    return code === '42P01' || code === '3F000';
}
