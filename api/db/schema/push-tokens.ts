import { sql } from 'drizzle-orm';
import { check, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { auditColumns } from './audit-columns';

/**
 * Operator devices registered for Expo Push. The token uniqueness lets the
 * register endpoint upsert by token without an extra lookup; the userAgent
 * column is opaque diagnostic context the client supplies (e.g. iOS / Android
 * version + app build), useful for triage when a device misbehaves.
 *
 * Rows live indefinitely until the device unregisters explicitly or the
 * dispatcher prunes them on a `DeviceNotRegistered` receipt from Expo.
 */
export const pushTokens = pgTable('push_tokens', {
    id: uuid('id').primaryKey().defaultRandom(),
    token: text('token').notNull().unique(),
    platform: text('platform').notNull(),
    userAgent: text('user_agent'),
    ...auditColumns,
}, (table) => [
    check('push_tokens_platform_check', sql`${table.platform} in ('ios', 'android')`),
]);
