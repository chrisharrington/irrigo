import { disableSchedule, type Schedule, type ScheduleManagerDb } from '@/daemon/schedule-manager';

/**
 * Dependencies the CLI entry point pulls from production wiring; the test
 * file injects deterministic stubs.
 */
export type DisableScheduleCliDeps = {
    disableSchedule: (db: ScheduleManagerDb, slug: string) => Promise<Schedule | null>;
    loadDb: () => Promise<ScheduleManagerDb>;
    log: (message: string) => void;
    error: (message: string) => void;
};

/**
 * CLI body for `bun run disable-schedule <slug>`. Exits non-zero when the
 * slug is missing from argv, when the slug is unknown, or when the
 * underlying disable call rejects.
 *
 * @param argv - Process argv (or test fixture). Slug is read from index 2.
 * @param deps - Injectable wiring; production passes the real DB + logger.
 * @returns The exit code (0 or 1).
 */
export async function disableScheduleCli(argv: ReadonlyArray<string>, deps: DisableScheduleCliDeps): Promise<0 | 1> {
    const slug = argv[2];
    if (!slug) {
        deps.error('disable-schedule: usage: bun run disable-schedule <slug>');
        return 1;
    }

    const db = await deps.loadDb();
    const result = await deps.disableSchedule(db, slug);
    if (result === null) {
        deps.error(`disable-schedule: no schedule with slug '${slug}'.`);
        return 1;
    }

    deps.log(`disable-schedule: disabled '${result.slug}' (${result.name}) on site ${result.siteId}.`);
    return 0;
}

if (import.meta.main) {
    const deps: DisableScheduleCliDeps = {
        disableSchedule,
        loadDb: async () => {
            const { db } = await import('@/db');
            return db as unknown as ScheduleManagerDb;
        },
        log: (m) => console.log(m),
        error: (m) => console.error(m),
    };
    disableScheduleCli(process.argv, deps).then(code => process.exit(code));
}
