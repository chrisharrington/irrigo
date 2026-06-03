import { sql } from 'drizzle-orm';
import { soilTypes } from '@/db/schema';
import type { SoilTypeSeed } from '@/data/seeds';
import type { SeedDb } from '.';

export async function upsertSoilTypes(db: SeedDb, rows: SoilTypeSeed[]): Promise<Map<string, string>> {
    if (rows.length === 0) return new Map();

    const inserted = await db
        .insert(soilTypes)
        .values(rows)
        .onConflictDoUpdate({
            target: soilTypes.slug,
            set: {
                name: sql`excluded.name`,
                availableWaterHoldingCapacityMmPerM: sql`excluded.available_water_holding_capacity_mm_per_m`,
                infiltrationRateMmPerHr: sql`excluded.infiltration_rate_mm_per_hr`,
            },
        })
        .returning({ id: soilTypes.id, slug: soilTypes.slug });

    return new Map(inserted.map(row => [row.slug, row.id]));
}
