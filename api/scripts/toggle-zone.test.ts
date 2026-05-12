import { describe, it, expect } from 'bun:test';
import { toggleZoneCli, type ToggleZoneDeps } from './toggle-zone';
import { createTestZone } from '@/mock/zone';
import type { Zone } from '@/models';

function makeDeps(overrides?: Partial<ToggleZoneDeps>): {
    deps: ToggleZoneDeps;
    zones: Zone[];
    opens: Zone[];
    closes: Zone[];
    logs: string[];
    errors: string[];
} {
    const zones = [
        createTestZone({ id: 'zone-1', name: 'Front Lawn' }),
        createTestZone({ id: 'zone-2', name: 'Back Garden' }),
    ];
    const opens: Zone[] = [];
    const closes: Zone[] = [];
    const logs: string[] = [];
    const errors: string[] = [];
    const deps: ToggleZoneDeps = {
        loadZones: async () => zones,
        getState: async () => 'off',
        open: async (zone) => { opens.push(zone); },
        close: async (zone) => { closes.push(zone); },
        log: m => logs.push(m),
        error: m => errors.push(m),
        ...overrides,
    };
    return { deps, zones, opens, closes, logs, errors };
}

describe('toggleZoneCli', () => {
    it('opens a zone that is off and returns 0', async () => {
        const { deps, opens, closes } = makeDeps({ getState: async () => 'off' });

        const code = await toggleZoneCli(1, deps);

        expect(code).toBe(0);
        expect(opens).toHaveLength(1);
        expect(closes).toHaveLength(0);
    });

    it('closes a zone that is on and returns 0', async () => {
        const { deps, opens, closes } = makeDeps({ getState: async () => 'on' });

        const code = await toggleZoneCli(1, deps);

        expect(code).toBe(0);
        expect(closes).toHaveLength(1);
        expect(opens).toHaveLength(0);
    });

    it('returns 1 and logs an error when state is unknown', async () => {
        const { deps, opens, closes, errors } = makeDeps({ getState: async () => 'unknown' });

        const code = await toggleZoneCli(1, deps);

        expect(code).toBe(1);
        expect(errors).toHaveLength(1);
        expect(errors[0]).toContain('unknown');
        expect(opens).toHaveLength(0);
        expect(closes).toHaveLength(0);
    });

    it('opens the zone at the correct index', async () => {
        const { deps, opens, zones } = makeDeps({ getState: async () => 'off' });

        await toggleZoneCli(2, deps);

        expect(opens[0]).toBe(zones[1]);
    });

    it('returns 1 when index is greater than number of zones', async () => {
        const { deps, errors } = makeDeps();

        const code = await toggleZoneCli(99, deps);

        expect(code).toBe(1);
        expect(errors[0]).toContain('out of range');
    });

    it('returns 1 when index is 0', async () => {
        const { deps, errors } = makeDeps();

        const code = await toggleZoneCli(0, deps);

        expect(code).toBe(1);
        expect(errors[0]).toContain('out of range');
    });

    it('returns 1 when the zone list is empty', async () => {
        const { deps, errors } = makeDeps({ loadZones: async () => [] });

        const code = await toggleZoneCli(1, deps);

        expect(code).toBe(1);
        expect(errors[0]).toContain('no zones');
    });

    it('returns 1 when loadZones throws', async () => {
        const { deps, errors } = makeDeps({
            loadZones: async () => { throw new Error('db down'); },
        });

        const code = await toggleZoneCli(1, deps);

        expect(code).toBe(1);
        expect(errors[0]).toContain('db down');
    });

    it('returns 1 when getState throws', async () => {
        const { deps, errors } = makeDeps({
            getState: async () => { throw new Error('HA timeout'); },
        });

        const code = await toggleZoneCli(1, deps);

        expect(code).toBe(1);
        expect(errors[0]).toContain('HA timeout');
    });

    it('returns 1 when open throws', async () => {
        const { deps, errors } = makeDeps({
            getState: async () => 'off',
            open: async () => { throw new Error('relay stuck'); },
        });

        const code = await toggleZoneCli(1, deps);

        expect(code).toBe(1);
        expect(errors[0]).toContain('relay stuck');
    });

    it('returns 1 when close throws', async () => {
        const { deps, errors } = makeDeps({
            getState: async () => 'on',
            close: async () => { throw new Error('relay stuck'); },
        });

        const code = await toggleZoneCli(1, deps);

        expect(code).toBe(1);
        expect(errors[0]).toContain('relay stuck');
    });

    it('logs zone name before opening', async () => {
        const { deps, logs, zones } = makeDeps({ getState: async () => 'off' });

        await toggleZoneCli(1, deps);

        expect(logs[0]).toContain(zones[0]!.name);
    });

    it('logs zone name before closing', async () => {
        const { deps, logs, zones } = makeDeps({ getState: async () => 'on' });

        await toggleZoneCli(1, deps);

        expect(logs[0]).toContain(zones[0]!.name);
    });
});
