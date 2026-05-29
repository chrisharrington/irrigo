export type ActivitySource = 'planner' | 'manual';

/**
 * One row in the Activity feed. Drives the Activity screen and Zone
 * detail's "Recent runs" tab.
 */
export type ActivityDto = {
    id: string;
    date: string;
    zone: { id: string; name: string; slug: string };
    appliedDepthMm: number;
    durationMin: number;
    /** ISO-8601 instant of the earliest cycle for this entry — MIN(COALESCE(firedAt, startTime)) on the api. `null` when the entry has no cycles. APP-78 / API-83. */
    startedAt: string | null;
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
