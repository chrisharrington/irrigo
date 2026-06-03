import type { FastifyInstance } from 'fastify';
import type { AckResult, AlertDto } from '@/alerts';

export function registerAlertRoutes(
    app: FastifyInstance,
    alerts: { list: () => Promise<AlertDto[]>; ack: (id: string) => Promise<AckResult> },
): void {
    /**
     * `GET /alerts` — returns the unacked alert list driving the mobile app's
     * persistent alert region. Empty array when no alerts are currently active
     * — the UI region collapses to zero height. Order is newest-first.
     */
    app.get('/alerts', async (_req, reply) => {
        const list = await alerts.list();
        return reply.code(200).send({ alerts: list });
    });

    /**
     * `POST /alerts/:id/ack` — dismisses an alert from the UI without
     * resolving the underlying condition. Idempotent: re-acking an already-
     * acked alert returns 200 (`already-acked`) rather than 409 so the mobile
     * client can safely retry on flaky connectivity. Returns 404 only when no
     * row matches the id at all.
     */
    app.post('/alerts/:id/ack', async (req, reply) => {
        const { id } = req.params as { id: string };
        const result = await alerts.ack(id);
        if (result === 'not-found') {
            return reply.code(404).send({ error: 'not-found', message: `Alert ${id} not found.` });
        }
        return reply.code(200).send({ status: result });
    });
}
