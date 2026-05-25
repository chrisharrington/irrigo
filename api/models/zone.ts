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
 * Most-recent actual fire per zone, as returned by `loadLatestFires`. `firedAt`
 * is the `irrigation_cycles.fired_at` timestamp of the latest cycle that
 * actually opened the valve — *not* the latest `schedule_entries.date`, which
 * would also include planned future entries written by the nightly planner.
 * `appliedDepthMm` is the gross depth of the parent `schedule_entries` row.
 */
export type LatestZoneFire = {
    zoneId: string;
    firedAt: Date;
    appliedDepthMm: number;
};
