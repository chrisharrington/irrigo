import { sql } from 'drizzle-orm';
import { boolean, check, doublePrecision, pgTable, real, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { auditColumns } from './audit-columns';
import { grassTypes } from './grass-types';
import { sites } from './sites';
import { soilTypes } from './soil-types';

export const zones = pgTable('zones', {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull().unique(),
    siteId: uuid('site_id').notNull().references(() => sites.id),
    name: text('name').notNull(),
    grassTypeId: uuid('grass_type_id').notNull().references(() => grassTypes.id),
    soilTypeId: uuid('soil_type_id').notNull().references(() => soilTypes.id),
    rootDepthM: real('root_depth_m').notNull(),
    allowableDepletionFraction: real('allowable_depletion_fraction').notNull(),
    irrigationEfficiency: real('irrigation_efficiency').notNull(),
    flowRateLPerMin: real('flow_rate_l_per_min').notNull(),
    areaM2: real('area_m2').notNull(),
    precipitationRateMmPerHr: real('precipitation_rate_mm_per_hr'),
    currentDepletionMm: real('current_depletion_mm').notNull().default(0),
    currentDepletionReconciledAt: timestamp('current_depletion_reconciled_at', { withTimezone: true }),
    isEnabled: boolean('is_enabled').notNull().default(true),
    latitude: doublePrecision('latitude'),
    longitude: doublePrecision('longitude'),
    homeAssistantEntityId: text('home_assistant_entity_id'),
    microclimateFactor: real('microclimate_factor').notNull().default(1),
    patch: text('patch').notNull().default('a'),
    ...auditColumns,
}, (table) => [check('zones_patch_check', sql`${table.patch} in ('a', 'b', 'c')`)]);
