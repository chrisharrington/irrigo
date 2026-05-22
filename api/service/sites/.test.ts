import { describe, expect, it } from 'bun:test';
import type { SitesRepository } from '@/repositories/sites';
import { bootSitesService, getSiteTimezone } from '.';

function fakeRepo(impl: Partial<SitesRepository>): SitesRepository {
    return {
        loadTimezone: async () => {
            throw new Error('not implemented');
        },
        ...impl,
    };
}

describe('sites service', () => {
    it('getSiteTimezone delegates to the repo and returns its value', async () => {
        bootSitesService({ repo: fakeRepo({ loadTimezone: async () => 'America/Edmonton' }) });

        const tz = await getSiteTimezone();

        expect(tz).toBe('America/Edmonton');
    });

    it('boot replaces the previous repo handle', async () => {
        bootSitesService({ repo: fakeRepo({ loadTimezone: async () => 'UTC' }) });
        bootSitesService({ repo: fakeRepo({ loadTimezone: async () => 'Europe/London' }) });

        const tz = await getSiteTimezone();

        expect(tz).toBe('Europe/London');
    });
});
