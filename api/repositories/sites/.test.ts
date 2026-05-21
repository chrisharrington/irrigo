import { describe, expect, it, spyOn } from 'bun:test';
import type { Database } from '@/db';
import { createSitesRepository } from '.';

function stubDb(rows: Array<{ timezone: string }>): Database {
    return {
        select: () => ({
            from: () => Promise.resolve(rows),
        }),
    } as unknown as Database;
}

describe('createSitesRepository.loadTimezone', () => {
    it('returns the first row timezone when exactly one site exists', async () => {
        const repo = createSitesRepository(stubDb([{ timezone: 'America/Edmonton' }]));

        const tz = await repo.loadTimezone();

        expect(tz).toBe('America/Edmonton');
    });

    it('returns UTC with a warn when no site rows exist', async () => {
        const warn = spyOn(console, 'warn').mockImplementation(() => {});
        try {
            const repo = createSitesRepository(stubDb([]));

            const tz = await repo.loadTimezone();

            expect(tz).toBe('UTC');
            expect(warn).toHaveBeenCalled();
        } finally {
            warn.mockRestore();
        }
    });

    it(`warns and uses the first row's timezone when multiple sites are present`, async () => {
        const warn = spyOn(console, 'warn').mockImplementation(() => {});
        try {
            const repo = createSitesRepository(
                stubDb([{ timezone: 'America/Edmonton' }, { timezone: 'America/Toronto' }]),
            );

            const tz = await repo.loadTimezone();

            expect(tz).toBe('America/Edmonton');
            expect(warn).toHaveBeenCalled();
        } finally {
            warn.mockRestore();
        }
    });
});
