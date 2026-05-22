import type { Database } from '@/db';
import { createSitesRepository, type SitesRepository } from '@/repositories/sites';

/**
 * Input to `bootSitesService`. Production passes `{ db }`; tests pass
 * `{ repo }` with an object-literal fake.
 */
export type BootSitesServiceInput =
    | { db: Database }
    | { repo: SitesRepository };

let repo: SitesRepository | null = null;

/**
 * Wires the sites service to its repository. Call once at process boot;
 * call again in test `beforeEach` with a fake to isolate behavior.
 */
export function bootSitesService(input: BootSitesServiceInput): void {
    repo = 'repo' in input ? input.repo : createSitesRepository(input.db);
}

function getRepo(): SitesRepository {
    if (!repo) {
        throw new Error('Sites service not booted — call bootSitesService({ db }) at startup.');
    }
    return repo;
}

/**
 * Returns the (single) site's IANA timezone string. Mirrors the repository's
 * fallback semantics: returns `'UTC'` with a warn when no rows exist.
 */
export async function getSiteTimezone(): Promise<string> {
    return getRepo().loadTimezone();
}
