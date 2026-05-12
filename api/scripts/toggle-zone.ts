import type { Zone } from '@/models';
import type { ZoneRelayState } from '@/data/home-assistant';

export type ToggleZoneDeps = {
    loadZones: () => Promise<Zone[]>;
    getState: (zone: Zone) => Promise<ZoneRelayState>;
    open: (zone: Zone) => Promise<void>;
    close: (zone: Zone) => Promise<void>;
    log: (message: string) => void;
    error: (message: string) => void;
};

export async function toggleZoneCli(index: number, deps: ToggleZoneDeps): Promise<0 | 1> {
    let zones: Zone[];
    try {
        zones = await deps.loadZones();
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        deps.error(`toggle-zone: failed to load zones — ${message}`);
        return 1;
    }

    if (zones.length === 0) {
        deps.error('toggle-zone: no zones found in the database.');
        return 1;
    }

    if (index < 1 || index > zones.length) {
        deps.error(`toggle-zone: index ${index} is out of range (1–${zones.length}).`);
        return 1;
    }

    const zone = zones[index - 1]!;

    let state: ZoneRelayState;
    try {
        state = await deps.getState(zone);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        deps.error(`toggle-zone: failed to read state for '${zone.name}' — ${message}`);
        return 1;
    }

    if (state === 'unknown') {
        deps.error(`toggle-zone: state of '${zone.name}' is unknown; cannot toggle safely.`);
        return 1;
    }

    if (state === 'on') {
        deps.log(`toggle-zone: '${zone.name}' is on — closing.`);
        try {
            await deps.close(zone);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            deps.error(`toggle-zone: failed to close '${zone.name}' — ${message}`);
            return 1;
        }
    } else {
        deps.log(`toggle-zone: '${zone.name}' is off — opening.`);
        try {
            await deps.open(zone);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            deps.error(`toggle-zone: failed to open '${zone.name}' — ${message}`);
            return 1;
        }
    }

    return 0;
}

if (import.meta.main) {
    const rawIndex = process.argv[2];
    if (!rawIndex) {
        console.error('toggle-zone: usage: bun run toggle-zone <index>  (index is 1-based)');
        process.exit(1);
    }

    const index = Number.parseInt(rawIndex, 10);
    if (!Number.isFinite(index) || index < 1) {
        console.error(`toggle-zone: index must be a positive integer, got '${rawIndex}'.`);
        process.exit(1);
    }

    const deps: ToggleZoneDeps = {
        loadZones: async () => {
            const { db } = await import('@/db');
            const { eq } = await import('drizzle-orm');
            const { grassTypes, soilTypes, sites, zones } = await import('@/db/schema');
            const { joinedRowToZone } = await import('@/daemon/zones');

            const rows = await db
                .select({ zone: zones, grassType: grassTypes, soilType: soilTypes, site: sites })
                .from(zones)
                .innerJoin(grassTypes, eq(zones.grassTypeId, grassTypes.id))
                .innerJoin(soilTypes, eq(zones.soilTypeId, soilTypes.id))
                .innerJoin(sites, eq(zones.siteId, sites.id));

            return rows
                .sort((a, b) => a.zone.name.localeCompare(b.zone.name))
                .map(joinedRowToZone);
        },
        getState: async (zone) => {
            const { getZoneState } = await import('@/data/home-assistant');
            return getZoneState(zone);
        },
        open: async (zone) => {
            const { openZone } = await import('@/data/home-assistant');
            return openZone(zone);
        },
        close: async (zone) => {
            const { closeZone } = await import('@/data/home-assistant');
            return closeZone(zone);
        },
        log: m => console.log(m),
        error: m => console.error(m),
    };

    toggleZoneCli(index, deps).then(code => process.exit(code));
}
