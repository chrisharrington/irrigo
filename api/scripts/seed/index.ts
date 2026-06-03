import path from 'node:path';
import { grassTypes, schedules, sites, soilTypes, zones } from '@/db/schema';
import {
    parseGrassTypes,
    parseSchedules,
    parseSites,
    parseSoilTypes,
    parseZones,
} from '@/data/seeds';
import { upsertGrassTypes } from './grass';
import { upsertSoilTypes } from './soil';
import { upsertSites } from './sites';
import { upsertZones } from './zones';
import { upsertSchedules } from './schedules';

/**
 * Minimal subset of the Drizzle client surface that the seed orchestrator
 * needs. Lets tests inject a recording stub without depending on a live
 * Postgres connection.
 */
export type SeedDb = {
    insert: (table: SeedTable) => SeedInsertBuilder;
};

export type SeedTable =
    | typeof grassTypes
    | typeof soilTypes
    | typeof sites
    | typeof zones
    | typeof schedules;

export type SeedInsertBuilder = {
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

const DEFAULT_DATA_DIR = path.resolve(import.meta.dir, '../../data/seeds');

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
    const soilDataMap = new Map(soilRows.map(r => [r.slug, r]));
    await upsertZones(db, zoneRows, { grassMap, soilMap, siteMap, soilDataMap });
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

if (import.meta.main) {
    seed()
        .then(() => process.exit(0))
        .catch((err: unknown) => {
            console.error('seed: failed.', err);
            process.exit(1);
        });
}
