import dayjs from 'dayjs';
import type { Database } from '@/db';
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
 */
export async function getZoneSummaries(): Promise<ZoneSummary[]> {
    const r = getRepo();
    const [rows, latest] = await Promise.all([
        r.loadJoinedRowsForSummary(),
        r.loadLatestScheduleEntries(),
    ]);
    const latestByZone = new Map<string, LatestZoneFire>(latest.map(entry => [entry.zoneId, entry]));
    const summaries = rows.map(row => mapJoinedRowToSummary(row, latestByZone.get(row.zone.id) ?? null));
    console.log(`zones: getZoneSummaries returned ${summaries.length} zone(s).`);
    return summaries;
}

/**
 * Pure mapping: turns a joined zones × grass × soil row plus an optional
 * latest-fire entry into the `ZoneSummary` DTO. Computes `rawMm` and rounds
 * to two decimals so the wire payload stays compact and stable.
 */
export function mapJoinedRowToSummary(
    row: SummaryJoinedRow,
    lastFire: LatestZoneFire | null,
): ZoneSummary {
    const rawMmRaw =
        row.soilType.availableWaterHoldingCapacityMmPerM *
        row.zone.rootDepthM *
        row.zone.allowableDepletionFraction;
    const rawMm = Math.round(rawMmRaw * 100) / 100;

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
        lastFiredAt: lastFire ? dayjs(lastFire.date).format('YYYY-MM-DD') : null,
        lastAppliedMm: lastFire ? lastFire.appliedDepthMm : null,
        homeAssistantEntityId: row.zone.homeAssistantEntityId,
        patch: row.zone.patch,
    };
}
