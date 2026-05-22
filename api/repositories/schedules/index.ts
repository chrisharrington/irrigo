import type dayjs from 'dayjs';
import { and, eq, isNotNull, lt, ne } from 'drizzle-orm';
import type { Database } from '@/db';
import { schedules } from '@/db/schema';

/**
 * Single-row representation of a `schedules` row, derived from Drizzle's
 * inferred row type. Re-exported so service / consumer code never needs to
 * import directly from `@/db/schema`.
 */
export type Schedule = typeof schedules.$inferSelect;

/**
 * Domain interface for the schedules table. Services depend on this exclusively
 * — they never see Drizzle's chain shape. The interface keeps the same
 * `slug`-keyed semantics as the previous `schedule-manager` module so the
 * service layer can be a thin pass-through.
 */
export interface SchedulesRepository {
    /**
     * Returns a `Map<siteId, Schedule>` of every active schedule. The partial
     * unique index `schedules_one_active_per_site` guarantees at most one row
     * per site, so the map is always unambiguous.
     */
    loadActiveBySite(): Promise<Map<string, Schedule>>;

    /**
     * Returns the schedule with the given slug, or `null` if no such row exists.
     */
    findBySlug(slug: string): Promise<Schedule | null>;

    /**
     * Atomically activates the schedule with the given slug, deactivating any
     * sibling that's currently active on the same site. Returns the post-update
     * row, or `null` if no schedule with that slug exists.
     */
    enable(slug: string): Promise<Schedule | null>;

    /**
     * Deactivates the schedule with the given slug. Idempotent: deactivating an
     * already-inactive schedule is a no-op success. Returns the row (with
     * `isActive: false`) or `null` if the slug is unknown.
     */
    disable(slug: string): Promise<Schedule | null>;

    /**
     * Sets `skippedNightDate = today` on the (single) active schedule. Returns
     * the post-update row, or `null` if no schedule is currently active.
     */
    skipActiveTonight(today: dayjs.Dayjs): Promise<Schedule | null>;

    /**
     * Clears the `skippedNightDate` marker on the (single) active schedule.
     * Idempotent at the data layer. Returns the post-update row, or `null` if
     * no schedule is currently active.
     */
    resumeActiveTonight(): Promise<Schedule | null>;

    /**
     * Clears any `skippedNightDate` strictly older than `today`. The daemon
     * calls this at the top of every `rePlan` so a marker from a past night
     * doesn't accumulate.
     */
    clearStaleSkipMarkers(today: dayjs.Dayjs): Promise<void>;
}

export function createSchedulesRepository(db: Database): SchedulesRepository {
    const findBySlug = async (slug: string): Promise<Schedule | null> => {
        const rows = await db
            .select({ schedule: schedules })
            .from(schedules)
            .where(eq(schedules.slug, slug));
        const row = rows[0];
        return row ? row.schedule : null;
    };

    return {
        loadActiveBySite: async () => {
            const rows = await db
                .select({ schedule: schedules })
                .from(schedules)
                .where(eq(schedules.isActive, true));

            const map = new Map<string, Schedule>();
            for (const row of rows) map.set(row.schedule.siteId, row.schedule);
            return map;
        },

        findBySlug,

        enable: async (slug) => {
            return db.transaction(async (tx) => {
                const txRepo = createSchedulesRepository(tx as unknown as Database);
                const target = await txRepo.findBySlug(slug);
                if (target === null) {
                    console.warn(`schedules: enable failed — no schedule with slug '${slug}'.`);
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

                console.log(`schedules: enabled schedule ${target.id} (${slug}) on site ${target.siteId}.`);
                return { ...target, isActive: true };
            });
        },

        disable: async (slug) => {
            const target = await findBySlug(slug);
            if (target === null) {
                console.warn(`schedules: disable failed — no schedule with slug '${slug}'.`);
                return null;
            }

            await db
                .update(schedules)
                .set({ isActive: false })
                .where(eq(schedules.id, target.id));

            console.log(`schedules: disabled schedule ${target.id} (${slug}) on site ${target.siteId}.`);
            return { ...target, isActive: false };
        },

        skipActiveTonight: async (today) => {
            const todayIso = today.format('YYYY-MM-DD');

            const rows = await db
                .select({ schedule: schedules })
                .from(schedules)
                .where(eq(schedules.isActive, true));

            const target = rows[0]?.schedule;
            if (!target) {
                console.warn('schedules: skip-tonight failed — no active schedule.');
                return null;
            }

            await db
                .update(schedules)
                .set({ skippedNightDate: todayIso })
                .where(eq(schedules.id, target.id));

            console.log(`schedules: marked schedule ${target.id} (${target.slug}) skipped for ${todayIso}.`);
            return { ...target, skippedNightDate: todayIso };
        },

        resumeActiveTonight: async () => {
            const rows = await db
                .select({ schedule: schedules })
                .from(schedules)
                .where(eq(schedules.isActive, true));

            const target = rows[0]?.schedule;
            if (!target) {
                console.warn('schedules: resume-tonight failed — no active schedule.');
                return null;
            }

            await db
                .update(schedules)
                .set({ skippedNightDate: null })
                .where(eq(schedules.id, target.id));

            console.log(`schedules: cleared skip marker on schedule ${target.id} (${target.slug}).`);
            return { ...target, skippedNightDate: null };
        },

        clearStaleSkipMarkers: async (today) => {
            const todayIso = today.format('YYYY-MM-DD');
            await db
                .update(schedules)
                .set({ skippedNightDate: null })
                .where(and(isNotNull(schedules.skippedNightDate), lt(schedules.skippedNightDate, todayIso)));
        },
    };
}
