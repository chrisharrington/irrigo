/**
 * One allowed irrigation window within a day. `start` and `end` are `HH:MM`
 * strings interpreted in the site's local timezone.
 */
export type ScheduleAllowedTimeWindow = {
    start: string;
    end: string;
};

/**
 * Derived "next run" labels rendered on the active-schedule chip and the
 * Schedules screen's active row.
 */
export type ScheduleNextRun = {
    inLabel: string;
    whenLabel: string;
    zonesLabel: string;
};

/**
 * Wire shape served by `GET /schedules` — one item per row in the
 * `schedules` table. `nextRun` and `skippedTonight` are present only on
 * the active row.
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

/**
 * Reply shape returned by every `POST /schedule/*` route.
 * `schedule.skippedNightDate` is present only for skip / resume.
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
