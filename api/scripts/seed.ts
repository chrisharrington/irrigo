import path from 'node:path';
import { sql } from 'drizzle-orm';
import { grassTypes, schedules, sites, soilTypes, zones } from '@/db/schema';
import {
    parseGrassTypes,
    parseSchedules,
    parseSites,
    parseSoilTypes,
    parseZones,
    type GrassTypeSeed,
    type ScheduleSeed,
    type SiteSeed,
    type SoilTypeSeed,
    type ZoneSeed,
} from '@/data/seeds';

/**
 * Minimal subset of the Drizzle client surface that the seed orchestrator
 * needs. Lets tests inject a recording stub without depending on a live
 * Postgres connection.
 */
export type SeedDb = {
    insert: (table: SeedTable) => SeedInsertBuilder;
};

type SeedTable =
    | typeof grassTypes
    | typeof soilTypes
    | typeof sites
    | typeof zones
    | typeof schedules;

type SeedInsertBuilder = {
    values: (rows: ReadonlyArray<Record<string, unknown>>) => SeedConflictBuilder;
};

type SeedConflictBuilder = {
    onConflictDoUpdate: (config: {
        target: unknown;
        set: Record<string, unknown>;
    }) => SeedReturningBuilder;
};

type SeedReturningBuilder = {
    returning: (cols: { id: unknown; slug: unknown }) => Promise<ReadonlyArray<{ id: string; slug: string }>>;
};

export type SeedOptions = {
    /** Optional. Drizzle client to use. Defaults to the eager `db` export. */
    db?: SeedDb;

    /** Optional. Directory holding the seed JSON files. Defaults to `api/data/seeds/`. */
    dataDir?: string;
};

export type SeedSummary = {
    grassTypes: number;
    soilTypes: number;
    sites: number;
    zones: number;
    schedules: number;
};

const DEFAULT_DATA_DIR = path.resolve(import.meta.dir, '../data/seeds');

/**
 * Loads each seed JSON file, validates it with Zod, and upserts the rows into
 * the database in dependency order: grass_types → soil_types → sites → zones.
 * Zones reference site/grass-type/soil-type by slug; the orchestrator resolves
 * those slugs against the maps returned from the prior upserts and throws if
 * any reference is unknown.
 *
 * Re-running is idempotent: each upsert uses ON CONFLICT (slug) DO UPDATE,
 * with the conflicting columns sourced from the proposed row via `excluded.*`.
 *
 * @param options - Orchestration options.
 * @returns Per-table counts of rows upserted.
 * @throws Error if a zone references an unknown slug, or if any JSON file
 *         fails schema validation.
 */
export async function seed(options?: SeedOptions): Promise<SeedSummary> {
    const db = options?.db ?? await loadDefaultDb();
    const dataDir = options?.dataDir ?? DEFAULT_DATA_DIR;

    console.log(`seed: loading seed data from ${dataDir}.`);

    const grassRows = parseGrassTypes(await readJson(dataDir, 'grass-types.json'));
    const soilRows = parseSoilTypes(await readJson(dataDir, 'soil-types.json'));
    const siteRows = parseSites(await readJson(dataDir, 'sites.json'));
    const zoneRows = parseZones(await readJson(dataDir, 'zones.json'));
    const scheduleRows = parseSchedules(await readJsonOptional(dataDir, 'schedules.json') ?? []);

    console.log(`seed: parsed ${grassRows.length} grass types, ${soilRows.length} soil types, ${siteRows.length} sites, ${zoneRows.length} zones, ${scheduleRows.length} schedules.`);

    const grassMap = await upsertGrassTypes(db, grassRows);
    const soilMap = await upsertSoilTypes(db, soilRows);
    const siteMap = await upsertSites(db, siteRows);
    await upsertZones(db, zoneRows, { grassMap, soilMap, siteMap });
    const scheduleCount = await upsertSchedules(db, scheduleRows, siteMap);

    console.log('seed: complete.');

    return {
        grassTypes: grassRows.length,
        soilTypes: soilRows.length,
        sites: siteRows.length,
        zones: zoneRows.length,
        schedules: scheduleCount,
    };
}

async function loadDefaultDb(): Promise<SeedDb> {
    const { db } = await import('@/db');
    return db as unknown as SeedDb;
}

async function readJson(dir: string, file: string): Promise<unknown> {
    const filePath = path.join(dir, file);
    const handle = Bun.file(filePath);
    if (!(await handle.exists())) throw new Error(`seed: missing seed file ${filePath}.`);
    return handle.json();
}

/**
 * Like `readJson` but returns `null` when the file is missing, so older
 * seed directories (or partial fixtures used in tests) can skip optional
 * seed files cleanly. Used for `schedules.json` — the rest of the seeds
 * are hard-required.
 */
async function readJsonOptional(dir: string, file: string): Promise<unknown> {
    const filePath = path.join(dir, file);
    const handle = Bun.file(filePath);
    if (!(await handle.exists())) return null;
    return handle.json();
}

async function upsertGrassTypes(db: SeedDb, rows: GrassTypeSeed[]): Promise<Map<string, string>> {
    if (rows.length === 0) return new Map();

    const inserted = await db
        .insert(grassTypes)
        .values(rows)
        .onConflictDoUpdate({
            target: grassTypes.slug,
            set: {
                name: sql`excluded.name`,
                cropCoefficient: sql`excluded.crop_coefficient`,
            },
        })
        .returning({ id: grassTypes.id, slug: grassTypes.slug });

    return new Map(inserted.map(row => [row.slug, row.id]));
}

async function upsertSoilTypes(db: SeedDb, rows: SoilTypeSeed[]): Promise<Map<string, string>> {
    if (rows.length === 0) return new Map();

    const inserted = await db
        .insert(soilTypes)
        .values(rows)
        .onConflictDoUpdate({
            target: soilTypes.slug,
            set: {
                name: sql`excluded.name`,
                availableWaterHoldingCapacityMmPerM: sql`excluded.available_water_holding_capacity_mm_per_m`,
                infiltrationRateMmPerHr: sql`excluded.infiltration_rate_mm_per_hr`,
            },
        })
        .returning({ id: soilTypes.id, slug: soilTypes.slug });

    return new Map(inserted.map(row => [row.slug, row.id]));
}

async function upsertSites(db: SeedDb, rows: SiteSeed[]): Promise<Map<string, string>> {
    if (rows.length === 0) return new Map();

    const valueRows = rows.map(row => ({
        slug: row.slug,
        name: row.name,
        timezone: row.timezone,
        latitude: row.latitude,
        longitude: row.longitude,
        address: row.address ?? null,
    }));

    const inserted = await db
        .insert(sites)
        .values(valueRows)
        .onConflictDoUpdate({
            target: sites.slug,
            set: {
                name: sql`excluded.name`,
                timezone: sql`excluded.timezone`,
                latitude: sql`excluded.latitude`,
                longitude: sql`excluded.longitude`,
                address: sql`excluded.address`,
            },
        })
        .returning({ id: sites.id, slug: sites.slug });

    return new Map(inserted.map(row => [row.slug, row.id]));
}

type ZoneLookups = {
    grassMap: Map<string, string>;
    soilMap: Map<string, string>;
    siteMap: Map<string, string>;
};

async function upsertZones(db: SeedDb, rows: ZoneSeed[], lookups: ZoneLookups): Promise<void> {
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
                currentDepletionMm: sql`excluded.current_depletion_mm`,
                isEnabled: sql`excluded.is_enabled`,
                latitude: sql`excluded.latitude`,
                longitude: sql`excluded.longitude`,
                homeAssistantEntityId: sql`excluded.home_assistant_entity_id`,
            },
        })
        .returning({ id: zones.id, slug: zones.slug });
}

async function upsertSchedules(
    db: SeedDb,
    rows: ScheduleSeed[],
    siteMap: Map<string, string>,
): Promise<number> {
    if (rows.length === 0) return 0;

    const valueRows = rows.map(row => {
        const siteId = siteMap.get(row.siteSlug);
        if (!siteId) throw new Error(`seed: schedule "${row.slug}" references unknown site "${row.siteSlug}".`);
        return {
            siteId,
            slug: row.slug,
            name: row.name,
            isActive: row.isActive,
            allowedDays: row.allowedDays,
            allowedTimeWindows: row.allowedTimeWindows,
        };
    });

    // Conflict target: composite (siteId, slug). On conflict only refresh `name` —
    // leave `isActive`, `allowedDays`, and `allowedTimeWindows` alone so re-seeding
    // doesn't clobber operator edits made via SQL or a future admin UI.
    await db
        .insert(schedules)
        .values(valueRows)
        .onConflictDoUpdate({
            target: [schedules.siteId, schedules.slug],
            set: {
                name: sql`excluded.name`,
            },
        })
        .returning({ id: schedules.id, slug: schedules.slug });

    return valueRows.length;
}

function resolveZone(row: ZoneSeed, lookups: ZoneLookups) {
    const siteId = lookups.siteMap.get(row.site);
    if (!siteId) throw new Error(`seed: zone "${row.slug}" references unknown site "${row.site}".`);

    const grassTypeId = lookups.grassMap.get(row.grassType);
    if (!grassTypeId) throw new Error(`seed: zone "${row.slug}" references unknown grassType "${row.grassType}".`);

    const soilTypeId = lookups.soilMap.get(row.soilType);
    if (!soilTypeId) throw new Error(`seed: zone "${row.slug}" references unknown soilType "${row.soilType}".`);

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
        currentDepletionMm: row.currentDepletionMm ?? 0,
        isEnabled: row.isEnabled ?? true,
        latitude: row.latitude ?? null,
        longitude: row.longitude ?? null,
        homeAssistantEntityId: row.homeAssistantEntityId ?? null,
    };
}

if (import.meta.main) {
    seed().catch((err: unknown) => {
        console.error('seed: failed.', err);
        process.exit(1);
    });
}
