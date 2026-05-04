import { test, expect } from 'bun:test';

// Set DATABASE_URL before the dynamic imports so the eager default exports in drizzle.config.ts
// and db/index.ts can evaluate without throwing. Static imports hoist above expressions, so a
// dynamic import is the only way to ensure ordering here.
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test_db';

const { buildDrizzleConfig } = await import('@/drizzle.config');
const { createDb, db } = await import('@/db/index');

test('drizzle config exposes the postgres dialect, schema path, and out folder', () => {
    const config = buildDrizzleConfig('postgresql://user:pass@host:5432/db');

    expect(config.dialect).toBe('postgresql');
    expect(config.schema).toBe('./db/schema');
    expect(config.out).toBe('./drizzle');
});

test('drizzle config carries the DATABASE_URL through to dbCredentials', () => {
    const url = 'postgresql://alice:secret@example.com:5432/irrigation';
    const config = buildDrizzleConfig(url);

    expect(config.dbCredentials).toEqual({ url });
});

test('drizzle config throws when DATABASE_URL is missing', () => {
    expect(() => buildDrizzleConfig(undefined)).toThrow('DATABASE_URL environment variable is required.');
});

test('drizzle config throws when DATABASE_URL is empty string', () => {
    expect(() => buildDrizzleConfig('')).toThrow('DATABASE_URL environment variable is required.');
});

test('createDb returns a Drizzle client exposing the standard query interface', () => {
    const client = createDb('postgresql://user:pass@host:5432/db');

    expect(typeof client.select).toBe('function');
    expect(typeof client.insert).toBe('function');
    expect(typeof client.update).toBe('function');
    expect(typeof client.delete).toBe('function');
    expect(typeof client.transaction).toBe('function');
});

test('eager db export is a Drizzle client', () => {
    expect(typeof db.select).toBe('function');
    expect(typeof db.insert).toBe('function');
});
