import { sql } from 'drizzle-orm';
import { sites } from '@/db/schema';
import type { SiteSeed } from '@/data/seeds';
import type { SeedDb } from '.';

export async function upsertSites(db: SeedDb, rows: SiteSeed[]): Promise<Map<string, string>> {
    if (rows.length === 0) return new Map();

    const valueRows = rows.map(row => ({
        slug: row.slug,
        name: row.name,
        timezone: row.timezone,
        latitude: row.latitude,
        longitude: row.longitude,
        address: row.address ?? null,
    }));

    const inserted = await db
        .insert(sites)
        .values(valueRows)
        .onConflictDoUpdate({
            target: sites.slug,
            set: {
                name: sql`excluded.name`,
                timezone: sql`excluded.timezone`,
                latitude: sql`excluded.latitude`,
                longitude: sql`excluded.longitude`,
                address: sql`excluded.address`,
            },
        })
        .returning({ id: sites.id, slug: sites.slug });

    return new Map(inserted.map(row => [row.slug, row.id]));
}
