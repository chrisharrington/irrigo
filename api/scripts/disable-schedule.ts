import Config from '@/config';
import type { Database } from '@/db';
import {
    bootSchedulesService,
    disableSchedule,
    type Schedule,
} from '@/service/schedules';

/**
 * Dependencies the CLI entry point pulls from production wiring; the test
 * file injects deterministic stubs.
 */
export type DisableScheduleCliDeps = {
    /** Boots the schedules service. Production wires `bootSchedulesService({ db })`. */
    bootService: () => Promise<void>;
    /** Performs the schedule disable. Defaults to the service's `disableSchedule`. */
    disable: (slug: string) => Promise<Schedule | null>;
    /**
     * Drives an immediate re-plan against the running api process so the
     * disabled schedule's effect materialises within seconds rather than at 04:00.
     */
    triggerReplan: () => Promise<void>;
    log: (message: string) => void;
    error: (message: string) => void;
};

/**
 * CLI body for `bun run disable-schedule <slug>`. Exits non-zero when the
 * slug is missing from argv, when the slug is unknown, or when the
 * underlying disable call rejects.
 */
export async function disableScheduleCli(argv: ReadonlyArray<string>, deps: DisableScheduleCliDeps): Promise<0 | 1> {
    const slug = argv[2];
    if (!slug) {
        deps.error('disable-schedule: usage: bun run disable-schedule <slug>');
        return 1;
    }

    await deps.bootService();
    const result = await deps.disable(slug);
    if (result === null) {
        deps.error(`disable-schedule: no schedule with slug '${slug}'.`);
        return 1;
    }

    deps.log(`disable-schedule: disabled '${result.slug}' (${result.name}) on site ${result.siteId}.`);

    try {
        await deps.triggerReplan();
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        deps.error(`disable-schedule: re-plan request failed — the DB change is already persisted. Re-run /replan to retry. Cause: ${message}`);
        return 1;
    }
    deps.log('disable-schedule: re-plan triggered.');
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
    const deps: DisableScheduleCliDeps = {
        bootService: async () => {
            const { db } = await import('@/db');
            bootSchedulesService({ db: db as unknown as Database });
        },
        disable: (slug) => disableSchedule(slug),
        triggerReplan: postReplan,
        log: (m) => console.log(m),
        error: (m) => console.error(m),
    };
    disableScheduleCli(process.argv, deps).then(code => process.exit(code));
}
