/**
 * The five lifecycle states the mobile Home hero can render.
 */
export type NextRunState = 'scheduled' | 'firing' | 'idle' | 'skipped-rain' | 'skipped-manual';

/**
 * One cycle in the per-zone payload. `start` is `HH:MM` in the site
 * timezone.
 */
export type NextRunCycle = {
    start: string;
    durMin: number;
};

/**
 * Per-zone summary for the run. `patch` carries the zone's visual
 * variant (`'a'`, `'b'`, `'c'`).
 */
export type NextRunZone = {
    name: string;
    slug: string;
    patch: string;
    cycles: NextRunCycle[];
};

/**
 * Wire shape served by `GET /tonight` (URL stays until the backend widens
 * to `/next-run` — see follow-up API ticket). `startTime` / `endsAt` are
 * ISO-8601 UTC instants (or `null`). `axisStart` / `axisEnd` / `sunset` /
 * `sunrise` are site-local `HH:MM` strings.
 */
export type NextRunDto = {
    state: NextRunState;
    startTime: string | null;
    endsAt: string | null;
    axisStart: string | null;
    axisEnd: string | null;
    sunset: string | null;
    sunrise: string | null;
    zoneOrder: string[];
    totalCycles: number;
    zones: NextRunZone[];
};
