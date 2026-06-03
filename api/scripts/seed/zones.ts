import { sql } from 'drizzle-orm';
import { zones } from '@/db/schema';
import type { SoilTypeSeed, ZoneSeed } from '@/data/seeds';
import { computeInitialDepletionMm } from './depletion';
import type { SeedDb } from '.';

type ZoneLookups = {
    grassMap: Map<string, string>;
    soilMap: Map<string, string>;
    siteMap: Map<string, string>;
    soilDataMap: Map<string, SoilTypeSeed>;
};

export async function upsertZones(db: SeedDb, rows: ZoneSeed[], lookups: ZoneLookups): Promise<void> {
    if (rows.length === 0) return;

    const resolved = rows.map(row => resolveZone(row, lookups));

    await db
        .insert(zones)
        .values(resolved)
        .onConflictDoUpdate({
            target: zones.slug,
            set: {
                siteId: sql`excluded.site_id`,
                grassTypeId: sql`excluded.grass_type_id`,
                soilTypeId: sql`excluded.soil_type_id`,
                name: sql`excluded.name`,
                rootDepthM: sql`excluded.root_depth_m`,
                allowableDepletionFraction: sql`excluded.allowable_depletion_fraction`,
                irrigationEfficiency: sql`excluded.irrigation_efficiency`,
                flowRateLPerMin: sql`excluded.flow_rate_l_per_min`,
                areaM2: sql`excluded.area_m2`,
                precipitationRateMmPerHr: sql`excluded.precipitation_rate_mm_per_hr`,
                isEnabled: sql`excluded.is_enabled`,
                latitude: sql`excluded.latitude`,
                longitude: sql`excluded.longitude`,
                homeAssistantEntityId: sql`excluded.home_assistant_entity_id`,
                microclimateFactor: sql`excluded.microclimate_factor`,
                patch: sql`excluded.patch`,
            },
        })
        .returning({ id: zones.id, slug: zones.slug });
}

function resolveZone(row: ZoneSeed, lookups: ZoneLookups) {
    const siteId = lookups.siteMap.get(row.site);
    if (!siteId) throw new Error(`seed: zone "${row.slug}" references unknown site "${row.site}".`);

    const grassTypeId = lookups.grassMap.get(row.grassType);
    if (!grassTypeId) throw new Error(`seed: zone "${row.slug}" references unknown grassType "${row.grassType}".`);

    const soilTypeId = lookups.soilMap.get(row.soilType);
    if (!soilTypeId) throw new Error(`seed: zone "${row.slug}" references unknown soilType "${row.soilType}".`);

    const soil = lookups.soilDataMap.get(row.soilType)!;

    return {
        slug: row.slug,
        name: row.name,
        siteId,
        grassTypeId,
        soilTypeId,
        rootDepthM: row.rootDepthM,
        allowableDepletionFraction: row.allowableDepletionFraction,
        irrigationEfficiency: row.irrigationEfficiency,
        flowRateLPerMin: row.flowRateLPerMin,
        areaM2: row.areaM2,
        precipitationRateMmPerHr: row.precipitationRateMmPerHr ?? null,
        currentDepletionMm: computeInitialDepletionMm(row, soil.availableWaterHoldingCapacityMmPerM),
        isEnabled: row.isEnabled ?? true,
        latitude: row.latitude ?? null,
        longitude: row.longitude ?? null,
        homeAssistantEntityId: row.homeAssistantEntityId ?? null,
        microclimateFactor: row.microclimateFactor ?? 1,
        patch: row.patch ?? 'a',
    };
}
