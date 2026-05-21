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
