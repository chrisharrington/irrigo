import type { FastifyInstance } from 'fastify';
import type { ZoneSummary } from '@/models/zone';

export function registerZonesSummaryRoute(
    app: FastifyInstance,
    zonesSummary: () => Promise<ZoneSummary[]>,
): void {
    /**
     * `GET /zones` — returns the zone summary list driving the mobile app's
     * Home zone-tile list and Zone detail header. Each entry includes grass
     * and soil names, computed `rawMm`, the latest fire summary, and the
     * `patch` variant. Errors propagate as Fastify's default 500 — there is
     * no external dependency to wrap as a 502 here.
     */
    app.get('/zones', async (_req, reply) => {
        const zones = await zonesSummary();
        return reply.code(200).send({ zones });
    });
}
