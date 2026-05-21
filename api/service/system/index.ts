import type { SystemStateRepository } from '@/repositories/system';
import type { SystemStateDto } from '@/models/system';

const FALLBACK_SINCE_ISO = new Date(0).toISOString();

/**
 * Reads the kill-switch state via the repository and maps it to the wire
 * DTO. If the singleton row is missing (a bypassed migration), warns and
 * returns the enabled default with the unix epoch as `since` so the api
 * process doesn't error out the route — operators can tell something is
 * off from the log line.
 *
 * @param repo - The system-state repository (production passes
 *   `createSystemStateRepository(db)`; tests pass an object literal).
 */
export async function getSystemState(repo: SystemStateRepository): Promise<SystemStateDto> {
    const row = await repo.findSingleton();
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
 * @param repo - The system-state repository.
 * @param enabled - The new value of the flag.
 * @param now - Timestamp to write into `since`.
 */
export async function setIrrigationEnabled(
    repo: SystemStateRepository,
    enabled: boolean,
    now: Date,
): Promise<SystemStateDto> {
    await repo.upsertSingleton(enabled, now);
    console.log(`system: irrigationEnabled=${enabled} since=${now.toISOString()}.`);
    return { irrigationEnabled: enabled, since: now.toISOString() };
}
