import Config from '@/config';
import { enableSchedule, type Schedule, type ScheduleManagerDb } from '@/daemon/schedule-manager';

/**
 * Dependencies the CLI entry point pulls from production wiring; the test
 * file injects deterministic stubs.
 */
export type EnableScheduleCliDeps = {
    enableSchedule: (db: ScheduleManagerDb, slug: string) => Promise<Schedule | null>;
    loadDb: () => Promise<ScheduleManagerDb>;
    /**
     * Drives an immediate re-plan against the running api process so the
     * new schedule's effect on cycles materialises within seconds rather
     * than at the next 04:00 tick. Production wiring POSTs `/replan`; the
     * tests pass a recording stub.
     */
    triggerReplan: () => Promise<void>;
    log: (message: string) => void;
    error: (message: string) => void;
};

/**
 * CLI body for `bun run enable-schedule <slug>`. Exits non-zero when the
 * slug is missing from argv, when the slug is unknown, or when the
 * underlying enable call rejects.
 *
 * @param argv - Process argv (or test fixture). Slug is read from index 2.
 * @param deps - Injectable wiring; production passes the real DB + logger.
 * @returns The exit code (0 or 1).
 */
export async function enableScheduleCli(argv: ReadonlyArray<string>, deps: EnableScheduleCliDeps): Promise<0 | 1> {
    const slug = argv[2];
    if (!slug) {
        deps.error('enable-schedule: usage: bun run enable-schedule <slug>');
        return 1;
    }

    const db = await deps.loadDb();
    const result = await deps.enableSchedule(db, slug);
    if (result === null) {
        deps.error(`enable-schedule: no schedule with slug '${slug}'.`);
        return 1;
    }

    deps.log(`enable-schedule: enabled '${result.slug}' (${result.name}) on site ${result.siteId}.`);

    try {
        await deps.triggerReplan();
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        deps.error(`enable-schedule: re-plan request failed — the DB change is already persisted. Re-run /replan to retry. Cause: ${message}`);
        return 1;
    }
    deps.log('enable-schedule: re-plan triggered.');
    return 0;
}

/**
 * Production `triggerReplan` wiring. POSTs `/replan` against the api's
 * own HTTP surface so the running daemon picks up the new schedule
 * within seconds. Override via `IRRIGO_BASE_URL` for non-default host /
 * port (e.g. when the CLI runs from a different host).
 */
async function postReplan(): Promise<void> {
    const baseUrl = process.env.IRRIGO_BASE_URL ?? `http://127.0.0.1:${Config.port}`;
    const response = await fetch(`${baseUrl}/replan`, { method: 'POST' });
    if (!response.ok) {
        const body = await response.text().catch(() => '<no body>');
        throw new Error(`POST ${baseUrl}/replan failed: ${response.status} ${response.statusText} — ${body}`);
    }
}

if (import.meta.main) {
    const deps: EnableScheduleCliDeps = {
        enableSchedule,
        loadDb: async () => {
            const { db } = await import('@/db');
            return db as unknown as ScheduleManagerDb;
        },
        triggerReplan: postReplan,
        log: (m) => console.log(m),
        error: (m) => console.error(m),
    };
    enableScheduleCli(process.argv, deps).then(code => process.exit(code));
}
