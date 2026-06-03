import { sql } from 'drizzle-orm';
import { schedules } from '@/db/schema';
import type { ScheduleSeed } from '@/data/seeds';
import type { SeedDb } from '.';

export async function upsertSchedules(
    db: SeedDb,
    rows: ScheduleSeed[],
    siteMap: Map<string, string>,
): Promise<number> {
    if (rows.length === 0) return 0;

    const valueRows = rows.map(row => {
        const siteId = siteMap.get(row.siteSlug);
        if (!siteId) throw new Error(`seed: schedule "${row.slug}" references unknown site "${row.siteSlug}".`);
        return {
            siteId,
            slug: row.slug,
            name: row.name,
            isActive: row.isActive,
            allowedDays: row.allowedDays,
            allowedTimeWindows: row.allowedTimeWindows,
            rootDepthMOverride: row.rootDepthMOverride,
            allowableDepletionFractionOverride: row.allowableDepletionFractionOverride,
            endBySunrise: row.endBySunrise ?? null,
        };
    });

    // Conflict target: composite (siteId, slug). On conflict only refresh `name` —
    // leave `isActive`, `allowedDays`, and `allowedTimeWindows` alone so re-seeding
    // doesn't clobber operator edits made via SQL or a future admin UI.
    await db
        .insert(schedules)
        .values(valueRows)
        .onConflictDoUpdate({
            target: [schedules.siteId, schedules.slug],
            set: {
                name: sql`excluded.name`,
            },
        })
        .returning({ id: schedules.id, slug: schedules.slug });

    return valueRows.length;
}
