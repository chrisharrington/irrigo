import { desc, eq, sql } from 'drizzle-orm';
import type { Database } from '@/db';
import { grassTypes, scheduleEntries, sites, soilTypes, zones } from '@/db/schema';
import type { Zone } from '@/models';
import type { LatestZoneFire } from '@/models/zone';

/**
 * Shape of a single row produced by the zones × grass_types × soil_types ×
 * sites join. Re-exported so the service tier (zone summary mapper) can use
 * the same type without re-deriving it.
 */
export type ZoneJoinedRow = {
    zone: typeof zones.$inferSelect;
    grassType: typeof grassTypes.$inferSelect;
    soilType: typeof soilTypes.$inferSelect;
    site: typeof sites.$inferSelect;
};

/**
 * Shape of the joined row used to build the wire `ZoneSummary` DTO. Mirrors
 * `ZoneJoinedRow` minus the site join — the summary payload doesn't expose
 * site-level fields.
 */
export type SummaryJoinedRow = {
    zone: typeof zones.$inferSelect;
    grassType: typeof grassTypes.$inferSelect;
    soilType: typeof soilTypes.$inferSelect;
};

/**
 * Result of `count()`. Used at daemon startup to distinguish "no zones in
 * the table at all" from "zones exist but every one is disabled".
 */
export type ZoneCountResult = {
    total: number;
    enabled: number;
};

/**
 * Domain interface for zone-table reads. Services consume the constructed
 * repository at boot; tests inject object-literal fakes.
 */
export interface ZonesRepository {
    /** Loads every enabled zone with its grass/soil/site joined in. */
    loadEnabled(): Promise<Zone[]>;

    /** Loads a single zone by id, or `null` when no such zone exists. */
    findById(zoneId: string): Promise<Zone | null>;

    /** Returns the total and enabled-only zone counts. */
    count(): Promise<ZoneCountResult>;

    /** Loads the zones × grass × soil joined rows used by the summary payload. */
    loadJoinedRowsForSummary(): Promise<SummaryJoinedRow[]>;

    /** Loads the most-recent `schedule_entries` row per zone (one row per zone that has fired). */
    loadLatestScheduleEntries(): Promise<LatestZoneFire[]>;
}

/**
 * Builds the production `ZonesRepository` bound to a Drizzle client. Internal
 * `joinedRowToZone` / `mapJoinedRowsToZones` mapping helpers are exported so
 * pure-function tests can exercise them directly without going through the
 * factory.
 */
export function createZonesRepository(db: Database): ZonesRepository {
    return {
        loadEnabled: async () => {
            const rows = await db
                .select({ zone: zones, grassType: grassTypes, soilType: soilTypes, site: sites })
                .from(zones)
                .innerJoin(grassTypes, eq(zones.grassTypeId, grassTypes.id))
                .innerJoin(soilTypes, eq(zones.soilTypeId, soilTypes.id))
                .innerJoin(sites, eq(zones.siteId, sites.id))
                .where(eq(zones.isEnabled, true));

            const result = mapJoinedRowsToZones(rows);
            console.log(`zones: loaded ${result.length} enabled zone(s).`);
            return result;
        },

        findById: async (zoneId) => {
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
        },

        count: async () => {
            const rows = await db
                .select({
                    total: sql<number>`count(*)::int`,
                    enabled: sql<number>`count(*) filter (where ${zones.isEnabled})::int`,
                })
                .from(zones);

            const row = rows[0];
            if (!row) return { total: 0, enabled: 0 };
            return { total: row.total, enabled: row.enabled };
        },

        loadJoinedRowsForSummary: async () => {
            return db
                .select({ zone: zones, grassType: grassTypes, soilType: soilTypes })
                .from(zones)
                .innerJoin(grassTypes, eq(zones.grassTypeId, grassTypes.id))
                .innerJoin(soilTypes, eq(zones.soilTypeId, soilTypes.id))
                .where(sql`true`);
        },

        loadLatestScheduleEntries: async () => {
            return db
                .selectDistinctOn([scheduleEntries.zoneId], {
                    zoneId: scheduleEntries.zoneId,
                    date: scheduleEntries.date,
                    appliedDepthMm: scheduleEntries.appliedDepthMm,
                })
                .from(scheduleEntries)
                .orderBy(scheduleEntries.zoneId, desc(scheduleEntries.date));
        },
    };
}

/**
 * Pure mapping: filters disabled rows and turns each joined row into a fully-
 * formed `Zone` with embedded grass type, soil type, and resolved location.
 */
export function mapJoinedRowsToZones(rows: ReadonlyArray<ZoneJoinedRow>): Zone[] {
    return rows.filter(row => row.zone.isEnabled !== false).map(joinedRowToZone);
}

/**
 * Maps a single joined row into a `Zone` model. Used by `loadEnabled` and
 * `findById`. Falls back to the site's lat/lon when the zone has no
 * coordinates of its own.
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
        microclimateFactor: row.zone.microclimateFactor,
    };
}
