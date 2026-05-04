import { pgTable, real, text, uuid } from 'drizzle-orm/pg-core';
import { auditColumns } from './audit-columns';

export const soilTypes = pgTable('soil_types', {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    availableWaterHoldingCapacityMmPerM: real('available_water_holding_capacity_mm_per_m').notNull(),
    infiltrationRateMmPerHr: real('infiltration_rate_mm_per_hr').notNull(),
    ...auditColumns,
});
