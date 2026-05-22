import { and, asc, eq, gte } from 'drizzle-orm';
import type { Database } from '@/db';
import { irrigationCycles, scheduleEntries, zones } from '@/db/schema';

/**
 * Hard cap on how many entry/cycle rows we'll read for the "tonight" lookup.
 * One night × all zones × handful of cycles is well under 50 rows even for
 * the largest realistic installs; 200 is room to spare.
 */
const TONIGHT_FETCH_LIMIT = 200;

/**
 * One row of the joined `scheduleEntries × zones × irrigationCycles` shape
 * that backs the "tonight" lister. The `cycle` slot is nullable because the
 * cycles table is left-joined — a planner-bootstrapped entry can exist before
 * its cycles have been materialised.
 */
export type TonightJoinedRow = {
    entry: typeof scheduleEntries.$inferSelect;
    cycle: typeof irrigationCycles.$inferSelect | null;
    zone: { id: string; name: string; slug: string; patch: string };
};

/**
 * Domain interface for reading the joined entries/cycles/zones rows that the
 * tonight composition logic needs. The service depends on this exclusively
 * — it never sees Drizzle's chain shape. Tests construct fakes as plain
 * object literals.
 */
export interface TonightRepository {
    /**
     * Returns every `scheduleEntries` row with `date >= cutoff` and
     * `source = 'scheduled'`, inner-joined to `zones` (id/name/slug/patch)
     * and left-joined to `irrigationCycles`. Ordered by entry date, then
     * zone id, then cycle start time. Capped at the module's internal fetch
     * limit — one night's worth of cycles per install is well under it.
     *
     * @param cutoff - The site-local `YYYY-MM-DD` lower bound on entry date.
     */
    findEntriesAfter(cutoff: string): Promise<TonightJoinedRow[]>;
}

/**
 * Builds the production `TonightRepository` bound to a Drizzle client. Tests
 * pass a partial stub via `as unknown as Database`.
 */
export function createTonightRepository(db: Database): TonightRepository {
    return {
        findEntriesAfter: async (cutoff) => {
            return db
                .select({
                    entry: scheduleEntries,
                    cycle: irrigationCycles,
                    zone: { id: zones.id, name: zones.name, slug: zones.slug, patch: zones.patch },
                })
                .from(scheduleEntries)
                .innerJoin(zones, eq(scheduleEntries.zoneId, zones.id))
                .leftJoin(irrigationCycles, eq(irrigationCycles.scheduleEntryId, scheduleEntries.id))
                .where(and(gte(scheduleEntries.date, cutoff), eq(scheduleEntries.source, 'scheduled')))
                .orderBy(asc(scheduleEntries.date), asc(zones.id), asc(irrigationCycles.startTime))
                .limit(TONIGHT_FETCH_LIMIT);
        },
    };
}
