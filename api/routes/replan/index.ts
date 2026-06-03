import type { FastifyInstance } from 'fastify';
import type { DaemonStatus } from '@/service/daemon';

export function registerReplanRoute(app: FastifyInstance, replan: () => Promise<void>, getStatus: () => DaemonStatus): void {
    /**
     * `POST /replan` — forces the daemon to re-plan immediately. Used by the
     * CLI scripts to make schedule changes take effect within seconds rather
     * than at the next 04:00 site-local tick. Returns 200 with the post-
     * re-plan `lastRePlanAt`; 502 if the re-plan itself rejects.
     */
    app.post('/replan', async (_req, reply) => {
        try {
            await replan();
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return reply.code(502).send({ error: 'replan-failed', message });
        }
        const status = getStatus();
        return reply.code(200).send({ status: 'replanned', lastRePlanAt: status.lastRePlanAt });
    });
}
