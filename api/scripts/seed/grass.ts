import { sql } from 'drizzle-orm';
import { grassTypes } from '@/db/schema';
import type { GrassTypeSeed } from '@/data/seeds';
import type { SeedDb } from '.';

export async function upsertGrassTypes(db: SeedDb, rows: GrassTypeSeed[]): Promise<Map<string, string>> {
    if (rows.length === 0) return new Map();

    const inserted = await db
        .insert(grassTypes)
        .values(rows)
        .onConflictDoUpdate({
            target: grassTypes.slug,
            set: {
                name: sql`excluded.name`,
                cropCoefficient: sql`excluded.crop_coefficient`,
            },
        })
        .returning({ id: grassTypes.id, slug: grassTypes.slug });

    return new Map(inserted.map(row => [row.slug, row.id]));
}
