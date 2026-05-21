import type { Database } from '@/db';
import { sites } from '@/db/schema';

/**
 * Domain interface for reading site-level configuration. The system today
 * assumes a single site; multi-site support would extend this surface with
 * id-keyed lookups.
 */
export interface SitesRepository {
    /**
     * Returns the (single) site's IANA timezone string. Falls back to `'UTC'`
     * with a warn when no site rows exist; warns and uses the first row's
     * timezone when multiple sites are present.
     */
    loadTimezone(): Promise<string>;
}

/**
 * Builds the production `SitesRepository` bound to a Drizzle client. Tests
 * pass a partial stub via `as unknown as Database`.
 */
export function createSitesRepository(db: Database): SitesRepository {
    return {
        loadTimezone: async () => {
            const rows = await db.select({ timezone: sites.timezone }).from(sites);

            if (rows.length === 0) {
                console.warn('sites: no sites found; defaulting timezone to UTC.');
                return 'UTC';
            }
            if (rows.length > 1) {
                console.warn(`sites: multiple sites found (${rows.length}); using the first row's timezone.`);
            }
            return rows[0]!.timezone;
        },
    };
}
