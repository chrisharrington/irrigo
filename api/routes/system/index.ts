import type { FastifyInstance } from 'fastify';
import type { SystemStateDto } from '@/models/system';

/**
 * HTTP surface of the master kill switch. Production wires this against
 * `getSystemState` / `setIrrigationEnabled` from `@/service/system`, optionally
 * wrapped with `wrapSystemWithReplan` so the daemon re-plans on each flip.
 */
export type SystemApi = {
    get: () => Promise<SystemStateDto>;
    enable: () => Promise<SystemStateDto>;
    disable: () => Promise<SystemStateDto>;
};

/**
 * Wraps a base `SystemApi` so each non-throwing `enable` / `disable` call
 * triggers `replan()` before resolving. Mirrors `wrapScheduleWithReplan`.
 * The `get` accessor is unwrapped — reads don't change planner state.
 *
 * @param base - The underlying handlers (DB-backed in production).
 * @param replan - The daemon's `rePlan` reference.
 */
export function wrapSystemWithReplan(base: SystemApi, replan: () => Promise<void>): SystemApi {
    return {
        get: () => base.get(),
        enable: async () => {
            const result = await base.enable();
            await replan();
            return result;
        },
        disable: async () => {
            const result = await base.disable();
            await replan();
            return result;
        },
    };
}

export function registerSystemRoutes(app: FastifyInstance, system: SystemApi): void {
    /**
     * `GET /system` — current state of the master irrigation kill switch.
     * Backs the mobile Home screen's toggle and "off since …" label.
     */
    app.get('/system', async (_req, reply) => {
        const state = await system.get();
        return reply.code(200).send(state);
    });

    /**
     * `POST /system/enable` — flip the kill switch on. Returns the post-flip
     * DTO (`since` reflects the time of this flip). 502 when the wrapped
     * re-plan rejects.
     */
    app.post('/system/enable', async (_req, reply) => {
        try {
            const state = await system.enable();
            return reply.code(200).send(state);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return reply.code(502).send({ error: 'replan-failed', message });
        }
    });

    /**
     * `POST /system/disable` — flip the kill switch off. Returns the post-flip
     * DTO. 502 when the wrapped re-plan rejects.
     */
    app.post('/system/disable', async (_req, reply) => {
        try {
            const state = await system.disable();
            return reply.code(200).send(state);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return reply.code(502).send({ error: 'replan-failed', message });
        }
    });
}
