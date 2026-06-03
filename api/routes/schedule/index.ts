import type { FastifyInstance } from 'fastify';
import type { Schedule } from '@/service/schedules';

/**
 * Subset of the `ScheduleManager` API exposed to HTTP. Both methods return
 * the post-update `Schedule` row, or `null` if the slug is unknown so the
 * route handler can map that to a 404.
 */
export type ScheduleApi = {
    enable: (slug: string) => Promise<Schedule | null>;
    disable: (slug: string) => Promise<Schedule | null>;
    skipTonight: () => Promise<Schedule | null>;
    resumeTonight: () => Promise<Schedule | null>;
};

/**
 * Wraps a base `ScheduleApi` so that any non-null `enable` / `disable`
 * result triggers `replan` before resolving. The wrapper keeps the route
 * handler synchronous-looking: when the route awaits `schedule.enable`,
 * it implicitly awaits the re-plan too. When the base call returns null
 * (unknown slug), the re-plan is skipped — there's nothing to re-plan
 * against. Errors from `replan` propagate to the route, which maps them
 * to a 502 response.
 *
 * @param base - The underlying schedule manager (DB-backed in production).
 * @param replan - The daemon's `rePlan` reference.
 * @returns A new `ScheduleApi` that drives a re-plan after each successful
 *   activation change.
 */
export function wrapScheduleWithReplan(base: ScheduleApi, replan: () => Promise<void>): ScheduleApi {
    return {
        enable: async slug => {
            const result = await base.enable(slug);
            if (result !== null) await replan();
            return result;
        },
        disable: async slug => {
            const result = await base.disable(slug);
            if (result !== null) await replan();
            return result;
        },
        skipTonight: async () => {
            const result = await base.skipTonight();
            if (result !== null) await replan();
            return result;
        },
        resumeTonight: async () => {
            const result = await base.resumeTonight();
            if (result !== null) await replan();
            return result;
        },
    };
}

export function registerScheduleRoutes(app: FastifyInstance, schedule: ScheduleApi): void {
    /**
     * `POST /schedule/enable/:slug` — atomically activates the named schedule
     * and deactivates any other schedule that's currently active on the same
     * site. 200 with the schedule on success; 404 when the slug is unknown.
     */
    app.post('/schedule/enable/:slug', async (req, reply) => {
        const { slug } = req.params as { slug: string };
        let result;
        try {
            result = await schedule.enable(slug);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return reply.code(502).send({ error: 'replan-failed', message });
        }
        if (result === null) {
            return reply.code(404).send({ error: 'not-found', message: `Schedule '${slug}' not found.` });
        }
        return reply.code(200).send({
            status: 'enabled',
            schedule: { slug: result.slug, name: result.name, siteId: result.siteId },
        });
    });

    /**
     * `POST /schedule/disable/:slug` — deactivates the named schedule.
     * Idempotent at the data layer (already-inactive returns success). 404
     * when the slug is unknown.
     */
    app.post('/schedule/disable/:slug', async (req, reply) => {
        const { slug } = req.params as { slug: string };
        let result;
        try {
            result = await schedule.disable(slug);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return reply.code(502).send({ error: 'replan-failed', message });
        }
        if (result === null) {
            return reply.code(404).send({ error: 'not-found', message: `Schedule '${slug}' not found.` });
        }
        return reply.code(200).send({
            status: 'disabled',
            schedule: { slug: result.slug, name: result.name, siteId: result.siteId },
        });
    });

    /**
     * `POST /schedule/skip-tonight` — sets a one-night skip marker on the active
     * schedule so the planner drops tonight's cycles. 404 if no schedule is
     * currently active; 502 if the wrapped re-plan rejects.
     */
    app.post('/schedule/skip-tonight', async (_req, reply) => {
        let result;
        try {
            result = await schedule.skipTonight();
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return reply.code(502).send({ error: 'replan-failed', message });
        }
        if (result === null) {
            return reply.code(404).send({ error: 'not-found', message: 'No active schedule.' });
        }
        return reply.code(200).send({
            status: 'skipped',
            schedule: {
                slug: result.slug,
                name: result.name,
                siteId: result.siteId,
                skippedNightDate: result.skippedNightDate,
            },
        });
    });

    /**
     * `POST /schedule/resume-tonight` — clears the skip marker on the active
     * schedule. Idempotent (already-cleared returns success). 404 if no
     * schedule is active; 502 if the wrapped re-plan rejects.
     */
    app.post('/schedule/resume-tonight', async (_req, reply) => {
        let result;
        try {
            result = await schedule.resumeTonight();
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return reply.code(502).send({ error: 'replan-failed', message });
        }
        if (result === null) {
            return reply.code(404).send({ error: 'not-found', message: 'No active schedule.' });
        }
        return reply.code(200).send({
            status: 'resumed',
            schedule: {
                slug: result.slug,
                name: result.name,
                siteId: result.siteId,
                skippedNightDate: result.skippedNightDate,
            },
        });
    });
}
