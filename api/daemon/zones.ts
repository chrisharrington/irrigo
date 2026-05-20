import dayjs from 'dayjs';
import { desc, eq, sql } from 'drizzle-orm';
import { grassTypes, scheduleEntries, sites, soilTypes, zones } from '@/db/schema';
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
        microclimateFactor: row.zone.microclimateFactor,
    };
}

/**
 * DTO shape returned by `GET /zones`. Drives the mobile app's Home zone-tile
 * list and seeds the Zone detail header. The shape is deliberately distinct
 * from the daemon-internal `Zone` model — it carries pre-computed `rawMm`,
 * patch-variant slug, and last-fire summary, all flattened for direct
 * rendering by the client.
 */
export type ZoneSummary = {
    id: string;
    slug: string;
    name: string;
    isEnabled: boolean;
    grassType: { name: string };
    soilType: { name: string };
    areaM2: number;
    rootDepthM: number;
    allowableDepletionFraction: number;
    irrigationEfficiency: number;
    microclimateFactor: number;
    precipitationRateMmPerHr: number | null;
    currentDepletionMm: number;
    rawMm: number;
    lastFiredAt: string | null;
    lastAppliedMm: number | null;
    homeAssistantEntityId: string | null;
    patch: string;
};

/**
 * Latest schedule-entry row per zone, as returned by `loadLatestScheduleEntries`.
 * `date` is the entry-date column (Postgres `date`, day-granularity) serialised
 * as a `YYYY-MM-DD` string. `appliedDepthMm` is the gross depth that was applied
 * to the zone on that date.
 */
export type LatestZoneFire = {
    zoneId: string;
    date: string;
    appliedDepthMm: number;
};

/**
 * Minimal db interface for the zones × grass × soil join used by the summary
 * loader. Mirrors `ZoneLoaderDb` but without the site join — the summary
 * payload doesn't expose site-level fields, so the extra join would be dead
 * weight on every request.
 */
export type SummaryJoinedRow = {
    zone: typeof zones.$inferSelect;
    grassType: typeof grassTypes.$inferSelect;
    soilType: typeof soilTypes.$inferSelect;
};

export type SummaryJoinDb = {
    select: (columns: {
        zone: typeof zones;
        grassType: typeof grassTypes;
        soilType: typeof soilTypes;
    }) => {
        from: (table: typeof zones) => SelectJoinChain<SummaryJoinedRow>;
    };
};

/**
 * Minimal db interface for the latest-entry-per-zone query. The Drizzle
 * runtime client satisfies it directly via `selectDistinctOn`; tests pass a
 * recording stub.
 */
export type LatestEntriesDb = {
    selectDistinctOn: (
        on: ReadonlyArray<unknown>,
        columns: {
            zoneId: typeof scheduleEntries.zoneId;
            date: typeof scheduleEntries.date;
            appliedDepthMm: typeof scheduleEntries.appliedDepthMm;
        },
    ) => {
        from: (table: typeof scheduleEntries) => {
            orderBy: (...exprs: ReadonlyArray<unknown>) => Promise<LatestZoneFire[]>;
        };
    };
};

/**
 * Composite db interface for the full summary path. The production Drizzle
 * `db` exposes both surfaces; tests can compose stubs by spreading two
 * recording objects.
 */
export type ZoneSummaryDb = SummaryJoinDb & LatestEntriesDb;

/**
 * Loads the zones × grass_types × soil_types join with no filter — both enabled
 * and disabled zones are returned so the operator can still see disabled zones
 * (greyed out) in the mobile app. Terminates with a no-op `where (true)` so the
 * existing `SelectJoinChain` shape can be reused as a test surface.
 *
 * @param db - Drizzle client (or compatible stub).
 * @returns All zones with their grass and soil rows joined in.
 */
export async function loadZoneJoinedRowsForSummary(db: SummaryJoinDb): Promise<SummaryJoinedRow[]> {
    return db
        .select({ zone: zones, grassType: grassTypes, soilType: soilTypes })
        .from(zones)
        .innerJoin(grassTypes, eq(zones.grassTypeId, grassTypes.id))
        .innerJoin(soilTypes, eq(zones.soilTypeId, soilTypes.id))
        .where(sql`true`);
}

/**
 * Loads the most-recent `schedule_entries` row per zone via `DISTINCT ON`. The
 * result contains at most one row per zone — zones that have never fired are
 * absent from the result entirely. Callers should consult the returned map by
 * zone id and fall back to null when no entry is present.
 *
 * @param db - Drizzle client (or compatible stub).
 * @returns Array of latest fires, one row per zone that has fired at least once.
 */
export async function loadLatestScheduleEntries(db: LatestEntriesDb): Promise<LatestZoneFire[]> {
    return db
        .selectDistinctOn([scheduleEntries.zoneId], {
            zoneId: scheduleEntries.zoneId,
            date: scheduleEntries.date,
            appliedDepthMm: scheduleEntries.appliedDepthMm,
        })
        .from(scheduleEntries)
        .orderBy(scheduleEntries.zoneId, desc(scheduleEntries.date));
}

/**
 * Loads the full `ZoneSummary` list for the mobile app's Home screen and Zone
 * detail header. Fans out two queries in parallel — the zones×grass×soil join
 * and the latest-fire-per-zone DISTINCT ON — then merges them in JS by zone id.
 * The two-query approach keeps both stubs (and both production queries) simple.
 *
 * @param db - Drizzle client (or compatible stub).
 * @returns The list of `ZoneSummary` DTOs, one per zone in the database.
 */
export async function loadZoneSummaries(db: ZoneSummaryDb): Promise<ZoneSummary[]> {
    const [rows, latest] = await Promise.all([
        loadZoneJoinedRowsForSummary(db),
        loadLatestScheduleEntries(db),
    ]);
    const latestByZone = new Map<string, LatestZoneFire>(latest.map(entry => [entry.zoneId, entry]));
    const summaries = rows.map(row => mapJoinedRowToSummary(row, latestByZone.get(row.zone.id) ?? null));
    console.log(`api: loadZoneSummaries returned ${summaries.length} zone(s).`);
    return summaries;
}

/**
 * Pure mapping: turns a joined zones × grass × soil row plus an optional
 * latest-fire entry into the `ZoneSummary` DTO. Computes `rawMm =
 * AWHC × rootDepthM × allowableDepletionFraction` server-side and rounds to two
 * decimals so the wire payload stays compact and stable (the floating-point
 * tail otherwise leaks 17 digits). When `lastFire` is null, both `lastFiredAt`
 * and `lastAppliedMm` are emitted as `null`.
 *
 * @param row - Joined row from `loadZoneJoinedRowsForSummary`.
 * @param lastFire - Latest schedule-entry for this zone, or null when the zone
 *   has never fired.
 * @returns A fully-formed `ZoneSummary` DTO.
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
