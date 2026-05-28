import type { Database } from '@/db';
import type { ActiveManualSnapshot } from '@/models/manual';
import type { Zone } from '@/models';
import type { LatestZoneFire, ZoneSummary } from '@/models/zone';
import {
    createZonesRepository,
    type SummaryJoinedRow,
    type ZoneCountResult,
    type ZonesRepository,
} from '@/repositories/zones';

/**
 * Input to `bootZonesService`. Production passes `{ db }`; tests pass
 * `{ repo }` with an object-literal fake.
 */
export type BootZonesServiceInput =
    | { db: Database }
    | { repo: ZonesRepository };

let repo: ZonesRepository | null = null;

/**
 * Wires the zones service to its repository. Call once at process boot;
 * call again in test `beforeEach` with a fake to isolate behavior.
 */
export function bootZonesService(input: BootZonesServiceInput): void {
    repo = 'repo' in input ? input.repo : createZonesRepository(input.db);
}

function getRepo(): ZonesRepository {
    if (!repo) {
        throw new Error('Zones service not booted — call bootZonesService({ db }) at startup.');
    }
    return repo;
}

/** Returns the (fully-formed) enabled zones. */
export async function getEnabledZones(): Promise<Zone[]> {
    return getRepo().loadEnabled();
}

/** Returns a single zone by id, or `null`. */
export async function getZoneById(zoneId: string): Promise<Zone | null> {
    return getRepo().findById(zoneId);
}

/** Returns the total and enabled-only zone counts. */
export async function getZoneCounts(): Promise<ZoneCountResult> {
    return getRepo().count();
}

/**
 * Loads the full `ZoneSummary` list for the mobile app's Home screen and Zone
 * detail header. Fans out two queries via the repository, then merges them in
 * JS by zone id. `rawMm` is computed here (service-tier DTO concern).
 *
 * @param activeFire - Snapshot of the active manual fire from
 *   `ManualController.getActiveZone()`, or `null` when nothing is firing. Used
 *   to set `isRunning` / `willCloseAt` on the matching zone. Sourced at the
 *   composition root so this function stays pure.
 */
export async function getZoneSummaries(activeFire: ActiveManualSnapshot | null): Promise<ZoneSummary[]> {
    const r = getRepo();
    const [rows, latest] = await Promise.all([
        r.loadJoinedRowsForSummary(),
        r.loadLatestFires(),
    ]);
    const latestByZone = new Map<string, LatestZoneFire>(latest.map(entry => [entry.zoneId, entry]));
    const summaries = rows.map(row => mapJoinedRowToSummary(row, latestByZone.get(row.zone.id) ?? null, activeFire));
    console.log(`zones: getZoneSummaries returned ${summaries.length} zone(s).`);
    return summaries;
}

/**
 * Pure mapping: turns a joined zones × grass × soil row plus an optional
 * latest-fire entry and the active-manual-fire snapshot into the
 * `ZoneSummary` DTO. Computes `rawMm` and rounds to two decimals so the wire
 * payload stays compact and stable.
 *
 * `isRunning` is true only when `activeFire?.zoneId === row.zone.id`.
 * `willCloseAt` is the ISO of the snapshot's auto-close instant for the
 * matching zone — `null` for any non-matching zone, and `null` for the
 * matching zone when it was opened via the bare `open()` path (no
 * auto-close).
 */
export function mapJoinedRowToSummary(
    row: SummaryJoinedRow,
    lastFire: LatestZoneFire | null,
    activeFire: ActiveManualSnapshot | null,
): ZoneSummary {
    const rawMmRaw =
        row.soilType.availableWaterHoldingCapacityMmPerM *
        row.zone.rootDepthM *
        row.zone.allowableDepletionFraction;
    const rawMm = Math.round(rawMmRaw * 100) / 100;

    const isRunning = activeFire?.zoneId === row.zone.id;
    const willCloseAt = isRunning && activeFire?.willCloseAt
        ? activeFire.willCloseAt.toISOString()
        : null;

    return {
        id: row.zone.id,
        slug: row.zone.slug,
        name: row.zone.name,
        isEnabled: row.zone.isEnabled,
        grassType: { name: row.grassType.name },
        soilType: { name: row.soilType.name },
        areaM2: row.zone.areaM2,
        rootDepthM: row.zone.rootDepthM,
        allowableDepletionFraction: row.zone.allowableDepletionFraction,
        irrigationEfficiency: row.zone.irrigationEfficiency,
        microclimateFactor: row.zone.microclimateFactor,
        precipitationRateMmPerHr: row.zone.precipitationRateMmPerHr,
        currentDepletionMm: row.zone.currentDepletionMm,
        rawMm,
        lastFiredAt: lastFire ? lastFire.firedAt.toISOString() : null,
        lastAppliedMm: lastFire ? lastFire.appliedDepthMm : null,
        homeAssistantEntityId: row.zone.homeAssistantEntityId,
        patch: row.zone.patch,
        isRunning,
        willCloseAt,
    };
}
