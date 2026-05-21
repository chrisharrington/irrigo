import {
    loadSystemState,
    upsertSystemState,
    type SystemStateReaderDb,
    type SystemStateWriterDb,
} from '@/repositories/system';
import type { SystemStateDto } from '@/models/system';

const FALLBACK_SINCE_ISO = new Date(0).toISOString();

/**
 * Repository functions the system service depends on. Production passes
 * <code>defaultRepo</code> (the real DB-backed implementations); tests pass
 * fakes so service-level assertions don't need to drive Drizzle's chained
 * shape.
 *
 * Each service function only requires a <code>Pick</code> of this collection
 * (whatever it actually calls), so the test only stubs what's exercised.
 */
export type SystemServiceRepo = {
    loadSystemState: typeof loadSystemState;
    upsertSystemState: typeof upsertSystemState;
};

const defaultRepo: SystemServiceRepo = { loadSystemState, upsertSystemState };

/**
 * Reads the kill-switch state from the repository and maps it to the wire
 * DTO. If the singleton row is missing (a bypassed migration), warns and
 * returns the enabled default with the unix epoch as <code>since</code> so
 * the api process doesn't error out the route — operators can tell something
 * is off from the log line.
 *
 * @param db - Drizzle client (or compatible stub) for the underlying read.
 * @param repo - Optional override of the loader for fake-repo testing.
 */
export async function getSystemState(
    db: SystemStateReaderDb,
    repo: Pick<SystemServiceRepo, 'loadSystemState'> = defaultRepo,
): Promise<SystemStateDto> {
    const row = await repo.loadSystemState(db);
    if (!row) {
        console.warn('system: singleton row missing — falling back to enabled default. Re-run migrations.');
        return { irrigationEnabled: true, since: FALLBACK_SINCE_ISO };
    }
    return { irrigationEnabled: row.irrigationEnabled, since: row.since.toISOString() };
}

/**
 * Flips the kill switch via the repository and returns the post-update DTO
 * so route handlers can echo the new state back to the client without an
 * extra read.
 *
 * @param db - Drizzle client (or compatible stub) for the underlying upsert.
 * @param enabled - The new value of the flag.
 * @param now - Timestamp to write into <code>since</code>.
 * @param repo - Optional override of the writer for fake-repo testing.
 */
export async function setIrrigationEnabled(
    db: SystemStateWriterDb,
    enabled: boolean,
    now: Date,
    repo: Pick<SystemServiceRepo, 'upsertSystemState'> = defaultRepo,
): Promise<SystemStateDto> {
    await repo.upsertSystemState(db, enabled, now);
    console.log(`system: irrigationEnabled=${enabled} since=${now.toISOString()}.`);
    return { irrigationEnabled: enabled, since: now.toISOString() };
}
