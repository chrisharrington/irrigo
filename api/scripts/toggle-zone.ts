import type { Zone } from '@/models';
import type { ZoneRelayState } from '@/data/home-assistant';

export type ToggleZoneDeps = {
    loadZoneBySlug: (slug: string) => Promise<Zone | null>;
    getState: (zone: Zone) => Promise<ZoneRelayState>;
    open: (zone: Zone) => Promise<void>;
    close: (zone: Zone) => Promise<void>;
    log: (message: string) => void;
    error: (message: string) => void;
};

export async function toggleZoneCli(slug: string, deps: ToggleZoneDeps): Promise<0 | 1> {
    let zone: Zone | null;
    try {
        zone = await deps.loadZoneBySlug(slug);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        deps.error(`toggle-zone: failed to load zone '${slug}' — ${message}`);
        return 1;
    }

    if (!zone) {
        deps.error(`toggle-zone: no zone found with slug '${slug}'.`);
        return 1;
    }

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
    const slug = process.argv[2];
    if (!slug) {
        console.error('toggle-zone: usage: bun run toggle-zone <slug>  (e.g. north, south, east)');
        process.exit(1);
    }

    const deps: ToggleZoneDeps = {
        loadZoneBySlug: async (s) => {
            const { db } = await import('@/db');
            const { eq } = await import('drizzle-orm');
            const { grassTypes, soilTypes, sites, zones } = await import('@/db/schema');
            const { joinedRowToZone } = await import('@/daemon/zones');

            const rows = await db
                .select({ zone: zones, grassType: grassTypes, soilType: soilTypes, site: sites })
                .from(zones)
                .innerJoin(grassTypes, eq(zones.grassTypeId, grassTypes.id))
                .innerJoin(soilTypes, eq(zones.soilTypeId, soilTypes.id))
                .innerJoin(sites, eq(zones.siteId, sites.id))
                .where(eq(zones.slug, s));

            const row = rows[0];
            return row ? joinedRowToZone(row) : null;
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

    toggleZoneCli(slug, deps).then(code => process.exit(code));
}
