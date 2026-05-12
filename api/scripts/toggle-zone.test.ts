import { describe, it, expect } from 'bun:test';
import { toggleZoneCli, type ToggleZoneDeps } from './toggle-zone';
import { createTestZone } from '@/mock/zone';
import type { Zone } from '@/models';

const ZONE = createTestZone({ id: 'zone-1', name: 'North' });

function makeDeps(overrides?: Partial<ToggleZoneDeps>): {
    deps: ToggleZoneDeps;
    opens: Zone[];
    closes: Zone[];
    logs: string[];
    errors: string[];
} {
    const opens: Zone[] = [];
    const closes: Zone[] = [];
    const logs: string[] = [];
    const errors: string[] = [];
    const deps: ToggleZoneDeps = {
        loadZoneBySlug: async () => ZONE,
        getState: async () => 'off',
        open: async (zone) => { opens.push(zone); },
        close: async (zone) => { closes.push(zone); },
        log: m => logs.push(m),
        error: m => errors.push(m),
        ...overrides,
    };
    return { deps, opens, closes, logs, errors };
}

describe('toggleZoneCli', () => {
    it('opens a zone that is off and returns 0', async () => {
        const { deps, opens, closes } = makeDeps({ getState: async () => 'off' });

        const code = await toggleZoneCli('north', deps);

        expect(code).toBe(0);
        expect(opens).toHaveLength(1);
        expect(closes).toHaveLength(0);
    });

    it('closes a zone that is on and returns 0', async () => {
        const { deps, opens, closes } = makeDeps({ getState: async () => 'on' });

        const code = await toggleZoneCli('north', deps);

        expect(code).toBe(0);
        expect(closes).toHaveLength(1);
        expect(opens).toHaveLength(0);
    });

    it('returns 1 and logs an error when state is unknown', async () => {
        const { deps, opens, closes, errors } = makeDeps({ getState: async () => 'unknown' });

        const code = await toggleZoneCli('north', deps);

        expect(code).toBe(1);
        expect(errors).toHaveLength(1);
        expect(errors[0]).toContain('unknown');
        expect(opens).toHaveLength(0);
        expect(closes).toHaveLength(0);
    });

    it('passes the slug to loadZoneBySlug', async () => {
        const slugsSeen: string[] = [];
        const { deps } = makeDeps({
            loadZoneBySlug: async (s) => { slugsSeen.push(s); return ZONE; },
        });

        await toggleZoneCli('north', deps);

        expect(slugsSeen).toEqual(['north']);
    });

    it('returns 1 when no zone matches the slug', async () => {
        const { deps, errors } = makeDeps({ loadZoneBySlug: async () => null });

        const code = await toggleZoneCli('unknown-slug', deps);

        expect(code).toBe(1);
        expect(errors[0]).toContain('unknown-slug');
    });

    it('returns 1 when loadZoneBySlug throws', async () => {
        const { deps, errors } = makeDeps({
            loadZoneBySlug: async () => { throw new Error('db down'); },
        });

        const code = await toggleZoneCli('north', deps);

        expect(code).toBe(1);
        expect(errors[0]).toContain('db down');
    });

    it('returns 1 when getState throws', async () => {
        const { deps, errors } = makeDeps({
            getState: async () => { throw new Error('HA timeout'); },
        });

        const code = await toggleZoneCli('north', deps);

        expect(code).toBe(1);
        expect(errors[0]).toContain('HA timeout');
    });

    it('returns 1 when open throws', async () => {
        const { deps, errors } = makeDeps({
            getState: async () => 'off',
            open: async () => { throw new Error('relay stuck'); },
        });

        const code = await toggleZoneCli('north', deps);

        expect(code).toBe(1);
        expect(errors[0]).toContain('relay stuck');
    });

    it('returns 1 when close throws', async () => {
        const { deps, errors } = makeDeps({
            getState: async () => 'on',
            close: async () => { throw new Error('relay stuck'); },
        });

        const code = await toggleZoneCli('north', deps);

        expect(code).toBe(1);
        expect(errors[0]).toContain('relay stuck');
    });

    it('logs zone name before opening', async () => {
        const { deps, logs } = makeDeps({ getState: async () => 'off' });

        await toggleZoneCli('north', deps);

        expect(logs[0]).toContain(ZONE.name);
    });

    it('logs zone name before closing', async () => {
        const { deps, logs } = makeDeps({ getState: async () => 'on' });

        await toggleZoneCli('north', deps);

        expect(logs[0]).toContain(ZONE.name);
    });
});
