import { and, eq, isNotNull, lt, ne } from 'drizzle-orm';
import { schedules } from '@/db/schema';

/**
 * Single-row representation of a `schedules` row, derived from Drizzle's
 * inferred row type. Used as the return shape across the manager API.
 */
export type Schedule = typeof schedules.$inferSelect;

/**
 * Minimal Drizzle surface the schedule manager needs. The transaction shape
 * is the subset of `db.transaction(cb)` semantics we exercise: the callback
 * receives a tx with `select` + `update`. Tests pass a recording stub.
 */
export type ScheduleManagerDb = {
    select: (columns: { schedule: typeof schedules }) => {
        from: (table: typeof schedules) => {
            where: (cond: unknown) => Promise<Array<{ schedule: Schedule }>>;
        };
    } & {
        // Allow the `from` chain to also resolve directly when no `where` is supplied.
        from: (table: typeof schedules) => Promise<Array<{ schedule: Schedule }>>;
    };
    update: (table: typeof schedules) => {
        set: (values: Partial<Schedule>) => {
            where: (cond: unknown) => Promise<unknown>;
        };
    };
    transaction: <T>(callback: (tx: ScheduleManagerDb) => Promise<T>) => Promise<T>;
};

/**
 * Returns a `Map<siteId, Schedule>` of every active schedule. The partial
 * unique index `schedules_one_active_per_site` guarantees at most one row
 * per site, so the map is always unambiguous.
 *
 * @param db - Drizzle client (or compatible stub).
 */
export async function loadActiveSchedulesBySite(db: ScheduleManagerDb): Promise<Map<string, Schedule>> {
    const rows = await db
        .select({ schedule: schedules })
        .from(schedules)
        .where(eq(schedules.isActive, true));

    const map = new Map<string, Schedule>();
    for (const row of rows) {
        map.set(row.schedule.siteId, row.schedule);
    }
    return map;
}

/**
 * Returns the schedule with the given slug, or `null` if no such row exists.
 * Slugs are unique within a site (enforced by the composite index), but the
 * caller doesn't supply a `siteId` — slugs across sites can collide. For now
 * the system has one site, so this is unambiguous; callers that need to be
 * site-specific should filter the result.
 */
export async function loadScheduleBySlug(db: ScheduleManagerDb, slug: string): Promise<Schedule | null> {
    const rows = await db
        .select({ schedule: schedules })
        .from(schedules)
        .where(eq(schedules.slug, slug));

    const row = rows[0];
    return row ? row.schedule : null;
}

/**
 * Atomically activates the schedule with the given slug, deactivating any
 * sibling that's currently active on the same site. Wrapped in a single
 * transaction so the partial unique index never fires mid-flight.
 *
 * @returns The (now-active) schedule row, or `null` if no schedule with
 *   the given slug exists.
 */
export async function enableSchedule(db: ScheduleManagerDb, slug: string): Promise<Schedule | null> {
    return db.transaction(async tx => {
        const target = await loadScheduleBySlug(tx, slug);
        if (target === null) {
            console.warn(`schedule-manager: enable failed — no schedule with slug '${slug}'.`);
            return null;
        }

        await tx
            .update(schedules)
            .set({ isActive: false })
            .where(and(eq(schedules.siteId, target.siteId), ne(schedules.id, target.id)));

        await tx
            .update(schedules)
            .set({ isActive: true })
            .where(eq(schedules.id, target.id));

        console.log(`schedule-manager: enabled schedule ${target.id} (${slug}) on site ${target.siteId}.`);
        return { ...target, isActive: true };
    });
}

/**
 * Sets `skippedNightDate = todayIso` on the (single) active schedule. Powers
 * `POST /schedule/skip-tonight` — the operator override for a one-night skip.
 * Returns the post-update row, or `null` if no schedule is currently active.
 * The active row is identified by the partial unique index
 * `schedules_one_active_per_site`, which means there's at most one match per
 * site; the single-site deploy means there's at most one match overall.
 */
export async function skipActiveScheduleTonight(db: ScheduleManagerDb, todayIso: string): Promise<Schedule | null> {
    const rows = await db
        .select({ schedule: schedules })
        .from(schedules)
        .where(eq(schedules.isActive, true));

    const target = rows[0]?.schedule;
    if (!target) {
        console.warn('schedule-manager: skip-tonight failed — no active schedule.');
        return null;
    }

    await db
        .update(schedules)
        .set({ skippedNightDate: todayIso })
        .where(eq(schedules.id, target.id));

    console.log(`schedule-manager: marked schedule ${target.id} (${target.slug}) skipped for ${todayIso}.`);
    return { ...target, skippedNightDate: todayIso };
}

/**
 * Clears the `skippedNightDate` marker on the (single) active schedule. Powers
 * `POST /schedule/resume-tonight` — the Undo / Resume button. Idempotent at
 * the data layer (already-cleared returns success). Returns the post-update
 * row, or `null` if no schedule is currently active.
 */
export async function resumeActiveScheduleTonight(db: ScheduleManagerDb): Promise<Schedule | null> {
    const rows = await db
        .select({ schedule: schedules })
        .from(schedules)
        .where(eq(schedules.isActive, true));

    const target = rows[0]?.schedule;
    if (!target) {
        console.warn('schedule-manager: resume-tonight failed — no active schedule.');
        return null;
    }

    await db
        .update(schedules)
        .set({ skippedNightDate: null })
        .where(eq(schedules.id, target.id));

    console.log(`schedule-manager: cleared skip marker on schedule ${target.id} (${target.slug}).`);
    return { ...target, skippedNightDate: null };
}

/**
 * Clears any `skippedNightDate` strictly older than `todayIso`. The daemon
 * calls this at the top of every `rePlan` so a marker from a past night
 * doesn't accumulate or accidentally apply to a future plan. The marker is
 * only meaningful for the night it was created for — by the time tomorrow's
 * re-plan fires, the marker should be inert and cleaned up.
 */
export async function clearStaleSkipMarkers(db: ScheduleManagerDb, todayIso: string): Promise<void> {
    await db
        .update(schedules)
        .set({ skippedNightDate: null })
        .where(and(isNotNull(schedules.skippedNightDate), lt(schedules.skippedNightDate, todayIso)));
}

/**
 * Deactivates the schedule with the given slug. Idempotent: deactivating an
 * already-inactive schedule is a no-op success. Returns the row (with
 * `isActive: false`) or `null` if the slug is unknown.
 */
export async function disableSchedule(db: ScheduleManagerDb, slug: string): Promise<Schedule | null> {
    const target = await loadScheduleBySlug(db, slug);
    if (target === null) {
        console.warn(`schedule-manager: disable failed — no schedule with slug '${slug}'.`);
        return null;
    }

    await db
        .update(schedules)
        .set({ isActive: false })
        .where(eq(schedules.id, target.id));

    console.log(`schedule-manager: disabled schedule ${target.id} (${slug}) on site ${target.siteId}.`);
    return { ...target, isActive: false };
}
