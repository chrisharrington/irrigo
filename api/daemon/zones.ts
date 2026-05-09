import { eq, sql } from 'drizzle-orm';
import { grassTypes, sites, soilTypes, zones } from '@/db/schema';
import type { Zone } from '@/models';

/**
 * Shape of a single row produced by the zones × grass_types × soil_types ×
 * sites join used by the daemon's zone loader.
 */
export type ZoneJoinedRow = {
    zone: typeof zones.$inferSelect;
    grassType: typeof grassTypes.$inferSelect;
    soilType: typeof soilTypes.$inferSelect;
    site: typeof sites.$inferSelect;
};

/**
 * Recursive view of Drizzle's chained select-with-joins query. Each inner
 * join returns the same shape, so any number of joins can be added. The
 * chain terminates at `where(...)` which yields the typed result rows.
 */
export type SelectJoinChain<TRow> = {
    innerJoin: (table: unknown, on: unknown) => SelectJoinChain<TRow>;
    where: (cond: unknown) => Promise<TRow[]>;
};

/**
 * Minimal db interface needed by `loadEnabledZones`. Production callers pass
 * the real Drizzle `db`; tests pass a recording stub.
 */
export type ZoneLoaderDb = {
    select: (columns: {
        zone: typeof zones;
        grassType: typeof grassTypes;
        soilType: typeof soilTypes;
        site: typeof sites;
    }) => {
        from: (table: typeof zones) => SelectJoinChain<ZoneJoinedRow>;
    };
};

/**
 * Result of `countZones`. Used at daemon startup to distinguish "no zones in
 * the table at all" from "zones exist but every one is disabled".
 */
export type ZoneCountResult = {
    total: number;
    enabled: number;
};

/**
 * Minimal db interface for the count query. Single `select(...).from(zones)`
 * with no joins or where — Drizzle returns the chained promise directly.
 */
export type ZoneCountDb = {
    select: (columns: Record<string, unknown>) => {
        from: (table: typeof zones) => Promise<Array<{ total: number; enabled: number }>>;
    };
};

/**
 * Counts every zone row in a single query. Returns both the total and the
 * enabled-only count so callers can tell an empty table from one whose
 * zones are all disabled.
 *
 * @param db - Drizzle client (or compatible stub).
 * @returns `{ total, enabled }` zone counts.
 */
export async function countZones(db: ZoneCountDb): Promise<ZoneCountResult> {
    const rows = await db
        .select({
            total: sql<number>`count(*)::int`,
            enabled: sql<number>`count(*) filter (where ${zones.isEnabled})::int`,
        })
        .from(zones);

    const row = rows[0];
    if (!row) return { total: 0, enabled: 0 };
    return { total: row.total, enabled: row.enabled };
}

/**
 * Loads every enabled zone from the database with its grass type, soil type,
 * and site joined in. Returns fully-formed `Zone` models suitable for handing
 * directly to `runScheduleForZone`. Falls back to the site's lat/lon when the
 * zone has no coordinates of its own.
 *
 * @param db - Drizzle client (or a compatible stub).
 * @returns Array of enabled zones with embedded grass/soil/location.
 */
export async function loadEnabledZones(db: ZoneLoaderDb): Promise<Zone[]> {
    const rows = await db
        .select({ zone: zones, grassType: grassTypes, soilType: soilTypes, site: sites })
        .from(zones)
        .innerJoin(grassTypes, eq(zones.grassTypeId, grassTypes.id))
        .innerJoin(soilTypes, eq(zones.soilTypeId, soilTypes.id))
        .innerJoin(sites, eq(zones.siteId, sites.id))
        .where(eq(zones.isEnabled, true));

    const result = mapJoinedRowsToZones(rows);
    console.log(`daemon: loaded ${result.length} enabled zone(s).`);
    return result;
}

/**
 * Loads a single zone by id, joined with its grass/soil/site reference rows.
 * Returns `null` if no zone exists with that id. Disabled zones are still
 * returned — callers (e.g. the manual-fire HTTP routes) decide whether to
 * refuse based on `zone.isEnabled`.
 *
 * @param db - Drizzle client (or a compatible stub).
 * @param zoneId - The zone's UUID.
 * @returns The mapped Zone or null.
 */
export async function loadZoneById(db: ZoneLoaderDb, zoneId: string): Promise<Zone | null> {
    const rows = await db
        .select({ zone: zones, grassType: grassTypes, soilType: soilTypes, site: sites })
        .from(zones)
        .innerJoin(grassTypes, eq(zones.grassTypeId, grassTypes.id))
        .innerJoin(soilTypes, eq(zones.soilTypeId, soilTypes.id))
        .innerJoin(sites, eq(zones.siteId, sites.id))
        .where(eq(zones.id, zoneId));

    const row = rows[0];
    if (!row) return null;
    return joinedRowToZone(row);
}

/**
 * Pure mapping function: filters disabled rows and turns each joined row into
 * a fully-formed `Zone` with embedded grass type, soil type, and resolved
 * location. Tested directly to keep coverage tight without involving Drizzle.
 *
 * @param rows - Joined rows.
 * @returns Mapped, enabled-only zones in the same order as the input.
 */
export function mapJoinedRowsToZones(rows: ReadonlyArray<ZoneJoinedRow>): Zone[] {
    return rows.filter(row => row.zone.isEnabled !== false).map(joinedRowToZone);
}

/**
 * Maps a single joined row into a `Zone` model. Exported so other daemon
 * helpers (e.g. the future-cycles loader) can reuse the same shaping without
 * duplicating the field-by-field mapping.
 *
 * @param row - Joined row.
 * @returns A fully-formed Zone.
 */
export function joinedRowToZone(row: ZoneJoinedRow): Zone {
    const lat = row.zone.latitude ?? row.site.latitude,
        lon = row.zone.longitude ?? row.site.longitude;

    return {
        id: row.zone.id,
        name: row.zone.name,
        grassType: {
            name: row.grassType.name,
            cropCoefficient: row.grassType.cropCoefficient,
        },
        soil: {
            name: row.soilType.name,
            availableWaterHoldingCapacityMmPerM: row.soilType.availableWaterHoldingCapacityMmPerM,
            infiltrationRateMmPerHr: row.soilType.infiltrationRateMmPerHr,
        },
        rootDepthM: row.zone.rootDepthM,
        allowableDepletionFraction: row.zone.allowableDepletionFraction,
        irrigationEfficiency: row.zone.irrigationEfficiency,
        flowRateLPerMin: row.zone.flowRateLPerMin,
        areaM2: row.zone.areaM2,
        precipitationRateMmPerHr: row.zone.precipitationRateMmPerHr ?? undefined,
        currentDepletionMm: row.zone.currentDepletionMm,
        siteId: row.zone.siteId,
        siteTimezone: row.site.timezone,
        isEnabled: row.zone.isEnabled,
        location: { lat, lon },
        homeAssistantEntityId: row.zone.homeAssistantEntityId ?? undefined,
    };
}
