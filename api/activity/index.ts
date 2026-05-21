import { and, desc, eq, lt, or, sql } from 'drizzle-orm';
import { irrigationCycles, scheduleEntries, zones } from '@/db/schema';
import { decodeCursor, encodeCursor } from '@/util/cursor';

/**
 * Wire-format value for the entry's origin. The DB column stores the legacy
 * value `'scheduled'` for planner-driven entries (it's the column default),
 * but the mobile spec wants `'planner'` — so we map at the DTO boundary.
 */
export type ActivitySource = 'planner' | 'manual';

/**
 * One row in the Activity feed. Drives both the Activity screen and the
 * "Recent runs" section on Zone detail. `id` is the underlying
 * `schedule_entries.id` — also used to build the next-page cursor.
 *
 * `durationMin` is the SUM of associated `irrigation_cycles.duration_min`
 * rows (0 when an entry has no cycles, e.g. a planner entry that was deferred
 * by restrictions).
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
 * Parameters accepted by `listActivity`. `limit` is required from the caller
 * (the route handler applies the default + clamps) so the lister can stay
 * focused on data fetching rather than validation.
 */
export type ActivityListParams = {
    zoneId?: string;
    limit: number;
    cursor?: string;
};

/**
 * Result of a `listActivity` call. `nextCursor` is `null` when the result is
 * the last page; otherwise it's an opaque base64 string the client passes
 * back as `?cursor=…` to fetch the next page.
 */
export type ActivityListResult = {
    activity: ActivityDto[];
    nextCursor: string | null;
};

/** Default page size when the client omits `?limit=`. */
export const DEFAULT_ACTIVITY_LIMIT = 20;

/** Hard cap to keep the wire payload bounded under arbitrary clients. */
export const MAX_ACTIVITY_LIMIT = 100;

type ActivityJoinedRow = {
    entry: typeof scheduleEntries.$inferSelect;
    zone: { id: string; name: string; slug: string };
    durationMin: number;
};

/**
 * Minimal db interface the lister needs. Mirrors Drizzle's chained
 * select-with-joins shape so a recording stub can stand in for tests.
 */
export type ActivityDb = {
    select: (columns: {
        entry: typeof scheduleEntries;
        zone: { id: typeof zones.id; name: typeof zones.name; slug: typeof zones.slug };
        durationMin: unknown;
    }) => {
        from: (table: typeof scheduleEntries) => {
            innerJoin: (table: typeof zones, on: unknown) => {
                leftJoin: (table: typeof irrigationCycles, on: unknown) => {
                    where: (cond: unknown) => {
                        groupBy: (...exprs: ReadonlyArray<unknown>) => {
                            orderBy: (...exprs: ReadonlyArray<unknown>) => {
                                limit: (n: number) => Promise<ActivityJoinedRow[]>;
                            };
                        };
                    };
                };
            };
        };
    };
};

/**
 * Fetches a page of the chronological activity feed.
 *
 * Joins `schedule_entries × zones` for the row data, left-joins
 * `irrigation_cycles` for the runtime SUM. Pagination is keyset on
 * `(date DESC, id DESC)` — `date` is day-granularity so the secondary `id`
 * sort makes pages stable when multiple zones write on the same date.
 *
 * @param db - Drizzle client (or compatible stub).
 * @param params - Filter, page size, and optional cursor from the route.
 * @returns The page of DTOs plus `nextCursor` (null on the final page).
 */
export async function listActivity(db: ActivityDb, params: ActivityListParams): Promise<ActivityListResult> {
    const cursorParts = params.cursor !== undefined ? decodeCursor(params.cursor) : null;
    // The route handler validates the cursor before calling us; we only reach
    // this with a `cursor` field when it's well-formed. Treat `cursorParts ===
    // null` here as "no cursor supplied" (the undefined case).

    const conditions: unknown[] = [];
    if (params.zoneId !== undefined) {
        conditions.push(eq(scheduleEntries.zoneId, params.zoneId));
    }
    if (cursorParts !== null) {
        conditions.push(
            or(
                lt(scheduleEntries.date, cursorParts.date),
                and(eq(scheduleEntries.date, cursorParts.date), lt(scheduleEntries.id, cursorParts.id)),
            ),
        );
    }
    const whereCondition: unknown =
        conditions.length === 0 ? sql`true`
        : conditions.length === 1 ? conditions[0]
        : and(...(conditions as Parameters<typeof and>));

    const rows = await db
        .select({
            entry: scheduleEntries,
            zone: { id: zones.id, name: zones.name, slug: zones.slug },
            durationMin: sql<number>`COALESCE(SUM(${irrigationCycles.durationMin}), 0)`,
        })
        .from(scheduleEntries)
        .innerJoin(zones, eq(scheduleEntries.zoneId, zones.id))
        .leftJoin(irrigationCycles, eq(irrigationCycles.scheduleEntryId, scheduleEntries.id))
        .where(whereCondition)
        .groupBy(scheduleEntries.id, zones.id)
        .orderBy(desc(scheduleEntries.date), desc(scheduleEntries.id))
        .limit(params.limit + 1);

    const hasMore = rows.length > params.limit;
    const pageRows = hasMore ? rows.slice(0, params.limit) : rows;
    const activity = pageRows.map(rowToDto);
    const lastRow = pageRows[pageRows.length - 1];
    const nextCursor = hasMore && lastRow !== undefined ? encodeCursor(lastRow.entry.date, lastRow.entry.id) : null;

    console.log(`api: listActivity returned ${activity.length} entry/entries (zoneId=${params.zoneId ?? '*'}, more=${hasMore}).`);
    return { activity, nextCursor };
}

function rowToDto(row: ActivityJoinedRow): ActivityDto {
    return {
        id: row.entry.id,
        date: row.entry.date,
        zone: row.zone,
        appliedDepthMm: row.entry.appliedDepthMm,
        durationMin: row.durationMin,
        depletionBeforeMm: row.entry.depletionBeforeMm,
        depletionAfterMm: row.entry.depletionAfterMm,
        source: row.entry.source === 'manual' ? 'manual' : 'planner',
    };
}
