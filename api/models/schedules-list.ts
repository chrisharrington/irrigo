/**
 * One allowed irrigation window within a day. `start` and `end` are `HH:MM`
 * strings interpreted in the site's local timezone. Mirrors the
 * `ScheduleTimeWindow` shape from the schema so the wire payload doesn't
 * leak Drizzle types.
 */
export type ScheduleAllowedTimeWindow = {
    start: string;
    end: string;
};

/**
 * Derived "next run" labels rendered on the active-schedule chip and the
 * Schedules screen's active row. Formatted server-side so each client (app,
 * eventually a web dashboard) doesn't reimplement the rules.
 */
export type ScheduleNextRun = {
    inLabel: string;
    whenLabel: string;
    zonesLabel: string;
};

/**
 * Wire shape served by `GET /schedules` — one item per row in the `schedules`
 * table. `nextRun` and `skippedTonight` are present only on the active row
 * (and only when there's actually a next run to describe). Inactive rows
 * omit them so the client doesn't have to disambiguate `null` vs missing.
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
