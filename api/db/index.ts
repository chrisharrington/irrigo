import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '@/db/schema';

/**
 * Builds a Drizzle client from a Postgres connection URL. Exported separately so consumers
 * (tests, scripts) can construct ad-hoc clients without inheriting the eager default.
 */
export function createDb(databaseUrl: string) {
    console.log('Creating database connection.');
    const client = postgres(databaseUrl);
    return drizzle(client, { schema });
}

function readDatabaseUrl() {
    const url = process.env.DATABASE_URL;
    if (!url)
        throw new Error('DATABASE_URL environment variable is required.');
    return url;
}

export const db = createDb(readDatabaseUrl());
