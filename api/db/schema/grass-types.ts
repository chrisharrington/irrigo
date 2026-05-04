import { pgTable, real, text, uuid } from 'drizzle-orm/pg-core';
import { auditColumns } from './audit-columns';

export const grassTypes = pgTable('grass_types', {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    cropCoefficient: real('crop_coefficient').notNull(),
    ...auditColumns,
});
