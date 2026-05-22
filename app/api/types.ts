/**
 * DTOs mirroring the Irrigo API's wire contracts. These are hand-mirrored
 * rather than imported from `api/models/` because the app's tsconfig and
 * bundler don't reach across workspaces — the cost is a small amount of
 * duplication in exchange for an explicit, app-owned contract surface.
 *
 * Keep these in sync with the source-of-truth files referenced in the JSDoc
 * for each type. Any divergence between the wire payload and these shapes is
 * a bug — either update the type here or fix the api.
 */

/* ----- system (api/models/system.ts) ---------------------------------- */

/**
 * Wire-format snapshot of the master irrigation kill switch returned by
 * `GET /system`, `POST /system/enable`, and `POST /system/disable`. `since`
 * is the ISO-8601 UTC instant the system entered its current state.
 */
export type SystemStateDto = {
    irrigationEnabled: boolean;
    since: string;
};

/* ----- zones (api/models/zone.ts) ------------------------------------- */

/**
 * Wire shape returned by `GET /zones`. The api wraps the array in
 * `{ zones: ZoneSummary[] }` — the client unwraps for consumers.
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

/* ----- tonight (api/models/tonight.ts) -------------------------------- */

export type TonightState = 'scheduled' | 'firing' | 'idle' | 'skipped-rain' | 'skipped-manual';

export type TonightCycle = {
    start: string;
    durMin: number;
};

export type TonightZone = {
    name: string;
    slug: string;
    patch: string;
    cycles: TonightCycle[];
};

/**
 * Wire shape served by `GET /tonight`. `startTime` / `endsAt` are ISO-8601
 * UTC instants; `axisStart` / `axisEnd` / `sunset` / `sunrise` are site-local
 * `HH:MM` strings.
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

/* ----- schedules (api/models/schedules-list.ts) ----------------------- */

export type ScheduleAllowedTimeWindow = {
    start: string;
    end: string;
};

export type ScheduleNextRun = {
    inLabel: string;
    whenLabel: string;
    zonesLabel: string;
};

/**
 * Wire shape served by `GET /schedules`. `nextRun` and `skippedTonight` are
 * present only on the active row; inactive rows omit them.
 */
export type ScheduleListItem = {
    id: string;
    slug: string;
    name: string;
    isActive: boolean;
    allowedDays: number[] | null;
    allowedTimeWindows: ScheduleAllowedTimeWindow[] | null;
    rootDepthMOverride: number | null;
    allowableDepletionFractionOverride: number | null;
    endBySunrise: boolean | null;
    nextRun?: ScheduleNextRun | null;
    skippedTonight?: boolean;
};

/* ----- alerts (api/alerts/index.ts) ----------------------------------- */

export type AlertClass = 'weather-stale' | 'ha-call-failed' | 'missed-close';
export type AlertTone = 'warn' | 'danger';

/**
 * Wire shape served by `GET /alerts`. The api wraps the array in
 * `{ alerts: AlertDto[] }` — the client unwraps for consumers. `when` is
 * ISO-8601 UTC.
 */
export type AlertDto = {
    id: string;
    class: AlertClass;
    tone: AlertTone;
    title: string;
    sub: string | null;
    when: string;
    zoneId: string | null;
    ack: boolean;
};

/** Outcome of `POST /alerts/:id/ack`. */
export type AckResult = 'acked' | 'already-acked';

/* ----- activity (api/activity/index.ts) ------------------------------- */

export type ActivitySource = 'planner' | 'manual';

/**
 * One row in the Activity feed. Drives the Activity screen and Zone detail's
 * "Recent runs" tab.
 */
export type ActivityDto = {
    id: string;
    date: string;
    zone: { id: string; name: string; slug: string };
    appliedDepthMm: number;
    durationMin: number;
    depletionBeforeMm: number;
    depletionAfterMm: number;
    source: ActivitySource;
};

/**
 * One keyset-paginated page returned by `GET /activity`. `nextCursor` is
 * `null` on the last page.
 */
export type ActivityListResult = {
    activity: ActivityDto[];
    nextCursor: string | null;
};

/* ----- push tokens (api/models/push-token.ts) ------------------------- */

export type PushPlatform = 'ios' | 'android';

/**
 * Body shape accepted by `POST /push/register`.
 */
export type PushRegistration = {
    token: string;
    platform: PushPlatform;
    userAgent: string | null;
};

/* ----- schedule mutation replies (wire shape) ------------------------- */

/**
 * Reply shape returned by every `POST /schedule/*` route. `status` discriminates
 * the action; `schedule.skippedNightDate` is present only for skip / resume.
 */
export type ScheduleMutationResponse = {
    status: 'enabled' | 'disabled' | 'skipped' | 'resumed';
    schedule: {
        slug: string;
        name: string;
        siteId: string;
        skippedNightDate?: string | null;
    };
};

/* ----- manual zone control replies (wire shape) ----------------------- */

export type ZoneOpenResponse = { status: 'open'; since: string };
export type ZoneCloseResponse = { status: 'closed' };
export type ZoneRunResponse = { status: 'open'; since: string; willCloseAt: string };

/* ----- replan reply (wire shape) -------------------------------------- */

export type ReplanResponse = { status: 'replanned'; lastRePlanAt: string | null };

/* ----- daemon status -------------------------------------------------- */

/**
 * Wire shape returned by `GET /health`.
 */
export type DaemonStatus = {
    alive: boolean;
    lastRePlanAt: string | null;
    activeZones: ReadonlyArray<{ id: string; name: string }>;
};
