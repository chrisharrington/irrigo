import { defineConfig } from 'drizzle-kit';

/**
 * Builds the drizzle-kit config from a database URL. Exported separately so the validation
 * branch is testable without triggering the eager default export.
 */
export function buildDrizzleConfig(databaseUrl: string | undefined) {
    if (!databaseUrl)
        throw new Error('DATABASE_URL environment variable is required.');

    return defineConfig({
        dialect: 'postgresql',
        schema: './db/schema.ts',
        out: './drizzle',
        dbCredentials: {
            url: databaseUrl,
        },
    });
}

export default buildDrizzleConfig(process.env.DATABASE_URL);
