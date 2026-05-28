/**
 * Wire shape returned by `GET /zones`. The api wraps the array in
 * `{ zones: ZoneSummary[] }` — the endpoint wrapper unwraps for consumers.
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
    /** True when this zone is currently watering via a manual fire. APP-69 / API-81. */
    isRunning: boolean;
    /** ISO-8601 instant when the active manual fire will auto-close. `null` for bare opens (no auto-close) and for non-running zones. */
    willCloseAt: string | null;
};
