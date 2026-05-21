import type { Database } from '@/db';
import { createSystemStateRepository, type SystemStateRepository } from '@/repositories/system';
import type { SystemStateDto } from '@/models/system';

const FALLBACK_SINCE_ISO = new Date(0).toISOString();

/**
 * Input to `bootSystemService`. Production passes `{ db }` — the service
 * builds its own repository via the factory. Tests pass `{ repo }` with a
 * fake implementation of the interface; no Drizzle stub needed.
 */
export type BootSystemServiceInput =
    | { db: Database }
    | { repo: SystemStateRepository };

let repo: SystemStateRepository | null = null;

/**
 * Wires the system service to its repository. Call once at process boot
 * (api startup); call again in test `beforeEach` with a fake repository to
 * isolate behavior under test. Service functions throw with a clear message
 * if invoked before this is called.
 */
export function bootSystemService(input: BootSystemServiceInput): void {
    repo = 'repo' in input ? input.repo : createSystemStateRepository(input.db);
}

function getRepo(): SystemStateRepository {
    if (!repo) {
        throw new Error('System service not booted — call bootSystemService({ db }) at startup.');
    }
    return repo;
}

/**
 * Reads the kill-switch state and maps it to the wire DTO. If the singleton
 * row is missing (a bypassed migration), warns and returns the enabled
 * default with the unix epoch as `since` so the api process doesn't error
 * out the route — operators can tell something is off from the log line.
 */
export async function getSystemState(): Promise<SystemStateDto> {
    const row = await getRepo().findSingleton();
    if (!row) {
        console.warn('system: singleton row missing — falling back to enabled default. Re-run migrations.');
        return { irrigationEnabled: true, since: FALLBACK_SINCE_ISO };
    }
    return { irrigationEnabled: row.irrigationEnabled, since: row.since.toISOString() };
}

/**
 * Flips the kill switch and returns the post-update DTO so route handlers
 * can echo the new state back to the client without an extra read.
 *
 * @param enabled - The new value of the flag.
 * @param now - Timestamp to write into `since`.
 */
export async function setIrrigationEnabled(enabled: boolean, now: Date): Promise<SystemStateDto> {
    await getRepo().upsertSingleton(enabled, now);
    console.log(`system: irrigationEnabled=${enabled} since=${now.toISOString()}.`);
    return { irrigationEnabled: enabled, since: now.toISOString() };
}
