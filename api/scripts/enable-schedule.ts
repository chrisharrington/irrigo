import Config from '@/config';
import type { Database } from '@/db';
import {
    bootSchedulesService,
    enableSchedule,
    type Schedule,
} from '@/service/schedules';

/**
 * Dependencies the CLI entry point pulls from production wiring; the test
 * file injects deterministic stubs.
 */
export type EnableScheduleCliDeps = {
    /** Boots the schedules service. Production wires `bootSchedulesService({ db })`. */
    bootService: () => Promise<void>;
    /** Performs the schedule enable. Defaults to the service's `enableSchedule`. */
    enable: (slug: string) => Promise<Schedule | null>;
    /**
     * Drives an immediate re-plan against the running api process so the
     * new schedule's effect on cycles materialises within seconds rather
     * than at the next 04:00 tick.
     */
    triggerReplan: () => Promise<void>;
    log: (message: string) => void;
    error: (message: string) => void;
};

/**
 * CLI body for `bun run enable-schedule <slug>`. Exits non-zero when the
 * slug is missing from argv, when the slug is unknown, or when the
 * underlying enable call rejects.
 */
export async function enableScheduleCli(argv: ReadonlyArray<string>, deps: EnableScheduleCliDeps): Promise<0 | 1> {
    const slug = argv[2];
    if (!slug) {
        deps.error('enable-schedule: usage: bun run enable-schedule <slug>');
        return 1;
    }

    await deps.bootService();
    const result = await deps.enable(slug);
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
        bootService: async () => {
            const { db } = await import('@/db');
            bootSchedulesService({ db: db as unknown as Database });
        },
        enable: (slug) => enableSchedule(slug),
        triggerReplan: postReplan,
        log: (m) => console.log(m),
        error: (m) => console.error(m),
    };
    enableScheduleCli(process.argv, deps).then(code => process.exit(code));
}
