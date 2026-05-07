import { sites } from '@/db/schema';

/**
 * Minimal db interface for `loadSiteTimezone`. Single `select(...).from(sites)`
 * with no joins or where — Drizzle returns the chained promise directly.
 */
export type SiteTimezoneDb = {
    select: (columns: { timezone: typeof sites.timezone }) => {
        from: (table: typeof sites) => Promise<Array<{ timezone: string }>>;
    };
};

/**
 * Resolves the site timezone the daemon should use for re-plan scheduling
 * math. The system today assumes a single site; if zero or many rows are
 * present this logs a warning and falls back to the first row (or `'UTC'`
 * for the empty case) so the daemon can still boot.
 *
 * @param db - Drizzle client (or compatible stub).
 * @returns The site's IANA timezone string.
 */
export async function loadSiteTimezone(db: SiteTimezoneDb): Promise<string> {
    const rows = await db.select({ timezone: sites.timezone }).from(sites);

    if (rows.length === 0) {
        console.warn('daemon: no sites found; defaulting re-plan timezone to UTC.');
        return 'UTC';
    }
    if (rows.length > 1) {
        console.warn(`daemon: multiple sites found (${rows.length}); using the first row's timezone for re-plan scheduling.`);
    }
    return rows[0]!.timezone;
}
