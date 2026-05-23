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
