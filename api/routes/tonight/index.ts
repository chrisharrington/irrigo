import type { FastifyInstance } from 'fastify';
import type { TonightDto } from '@/models/tonight';

export function registerTonightRoute(app: FastifyInstance, tonight: () => Promise<TonightDto>): void {
    /**
     * `GET /tonight` — next-run summary for the mobile Home hero card and
     * CycleStrip. Re-evaluates on every request so a flip-to-disabled or a
     * just-fired cycle shows up immediately.
     */
    app.get('/tonight', async (_req, reply) => {
        const result = await tonight();
        return reply.code(200).send(result);
    });
}
