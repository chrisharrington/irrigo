/**
 * The five lifecycle states the mobile Home hero can render. `scheduled` and
 * `firing` are derived from per-cycle fire/close timestamps. `idle` covers
 * "no planner output for the next night yet" — typical when the soil isn't
 * dry enough to trigger irrigation. `skipped-manual` covers both the master
 * kill switch and the per-night skip marker. `skipped-rain` is reserved for
 * a future signal that distinguishes "no irrigation needed because rain
 * replenished soil" from `idle` — not emitted today.
 */
export type TonightState = 'scheduled' | 'firing' | 'idle' | 'skipped-rain' | 'skipped-manual';

/**
 * One cycle in the per-zone payload. `start` is the cycle's fire time
 * formatted as `HH:MM` in the site timezone — the CycleStrip renders against
 * a site-local axis, so absolute UTC isn't useful here.
 */
export type TonightCycle = {
    start: string;
    durMin: number;
};

/**
 * Per-zone summary for the night. `patch` carries the zone's visual variant
 * (`'a'`, `'b'`, `'c'`) — the mobile app maps that to color/glow tokens.
 * Matches the contract on `GET /zones`.
 */
export type TonightZone = {
    name: string;
    slug: string;
    patch: string;
    cycles: TonightCycle[];
};

/**
 * Wire shape served by `GET /tonight`.
 *
 * `startTime` / `endsAt` are ISO-8601 UTC instants (or `null` when idle or
 * skipped — there's nothing to anchor them to). `axisStart` / `axisEnd` are
 * site-local `HH:MM` strings that bound the CycleStrip x-axis; they fall
 * back to a tight padding around `startTime`/`endsAt` when `sunset`/`sunrise`
 * aren't yet persisted on the underlying entries. `sunset` / `sunrise` are
 * site-local `HH:MM` strings (or `null` during the bootstrap window before
 * the planner has populated the columns).
 */
export type TonightDto = {
    state: TonightState;
    startTime: string | null;
    endsAt: string | null;
    axisStart: string | null;
    axisEnd: string | null;
    sunset: string | null;
    sunrise: string | null;
    zoneOrder: string[];
    totalCycles: number;
    zones: TonightZone[];
};
