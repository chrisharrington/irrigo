import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { soilTypes, zones } from '@/db/schema';

const rows = await db
    .select({
        id: zones.id,
        slug: zones.slug,
        rootDepthM: zones.rootDepthM,
        allowableDepletionFraction: zones.allowableDepletionFraction,
        awcMmPerM: soilTypes.availableWaterHoldingCapacityMmPerM,
    })
    .from(zones)
    .innerJoin(soilTypes, eq(soilTypes.id, zones.soilTypeId));

for (const row of rows) {
    const rawMm = row.awcMmPerM * row.rootDepthM * row.allowableDepletionFraction;
    await db.update(zones).set({ currentDepletionMm: rawMm }).where(eq(zones.id, row.id));
    console.log(`reset-depletion-to-raw: zone ${row.slug} set currentDepletionMm=${rawMm.toFixed(2)} (100% of RAW).`);
}

console.log(`reset-depletion-to-raw: updated ${rows.length} zone(s).`);
process.exit(0);
