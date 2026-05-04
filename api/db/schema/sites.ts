import { doublePrecision, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { auditColumns } from './audit-columns';

export const sites = pgTable('sites', {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    timezone: text('timezone').notNull(),
    latitude: doublePrecision('latitude').notNull(),
    longitude: doublePrecision('longitude').notNull(),
    address: text('address'),
    ...auditColumns,
});
