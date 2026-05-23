/**
 * The five lifecycle states the mobile Home hero can render.
 */
export type TonightState = 'scheduled' | 'firing' | 'idle' | 'skipped-rain' | 'skipped-manual';

/**
 * One cycle in the per-zone payload. `start` is `HH:MM` in the site
 * timezone.
 */
export type TonightCycle = {
    start: string;
    durMin: number;
};

/**
 * Per-zone summary for the night. `patch` carries the zone's visual
 * variant (`'a'`, `'b'`, `'c'`).
 */
export type TonightZone = {
    name: string;
    slug: string;
    patch: string;
    cycles: TonightCycle[];
};

/**
 * Wire shape served by `GET /tonight`. `startTime` / `endsAt` are
 * ISO-8601 UTC instants (or `null`). `axisStart` / `axisEnd` / `sunset` /
 * `sunrise` are site-local `HH:MM` strings.
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
