import { eq } from 'drizzle-orm';
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
 * Minimal db interface needed by `loadEnabledZones` — mirrors the chained
 * Drizzle `select()` call. Production callers pass the real db; tests pass a
 * recording stub. The chain stays untyped beyond the surface shape because we
 * only care that the call sequence matches what Drizzle expects at runtime.
 */
export type ZoneLoaderDb = {
    select: (columns: {
        zone: typeof zones;
        grassType: typeof grassTypes;
        soilType: typeof soilTypes;
        site: typeof sites;
    }) => {
        from: (table: typeof zones) => {
            innerJoin: (table: unknown, on: unknown) => {
                innerJoin: (table: unknown, on: unknown) => {
                    innerJoin: (table: unknown, on: unknown) => {
                        where: (cond: unknown) => Promise<ZoneJoinedRow[]>;
                    };
                };
            };
        };
    };
};

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
 * Pure mapping function: filters disabled rows and turns each joined row into
 * a fully-formed `Zone` with embedded grass type, soil type, and resolved
 * location. Tested directly to keep coverage tight without involving Drizzle.
 *
 * @param rows - Joined rows.
 * @returns Mapped, enabled-only zones in the same order as the input.
 */
export function mapJoinedRowsToZones(rows: ReadonlyArray<ZoneJoinedRow>): Zone[] {
    return rows.filter(row => row.zone.isEnabled !== false).map(mapJoinedRowToZone);
}

function mapJoinedRowToZone(row: ZoneJoinedRow): Zone {
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
        isEnabled: row.zone.isEnabled,
        location: { lat, lon },
        homeAssistantEntityId: row.zone.homeAssistantEntityId ?? undefined,
    };
}
