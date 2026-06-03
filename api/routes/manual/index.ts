import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Zone } from '@/models';
import { BusyError, SystemDisabledError, type ManualController } from '@/service/manual';

export function registerManualRoutes(
    app: FastifyInstance,
    manual: ManualController,
    zoneById: (zoneId: string) => Promise<Zone | null>,
): void {
    /**
     * `POST /zones/:id/open` — opens the zone's relay via Home Assistant.
     * Returns 200 with the open timestamp on success, 404 if the zone id is
     * unknown, 409 if another fire (manual or scheduled) is already in
     * flight, or 502 if HA itself rejected the call.
     */
    app.post('/zones/:id/open', async (req, reply) => {
        const { id } = req.params as { id: string };
        const zone = await zoneById(id);
        if (!zone) return reply.code(404).send({ error: 'not-found', message: `Zone ${id} not found.` });

        try {
            const { since } = await manual.open(zone);
            return reply.code(200).send({ status: 'open', since: since.toISOString() });
        } catch (err) {
            return sendControllerError(reply, err);
        }
    });

    /**
     * `POST /zones/:id/close` — closes the zone's relay. Idempotent: closing
     * a relay that the controller doesn't track still issues HA's `turn_off`
     * (itself idempotent) and returns 200. 404 only when the zone id is
     * unknown; 502 when HA rejects.
     */
    app.post('/zones/:id/close', async (req, reply) => {
        const { id } = req.params as { id: string };
        const zone = await zoneById(id);
        if (!zone) return reply.code(404).send({ error: 'not-found', message: `Zone ${id} not found.` });

        try {
            await manual.close(zone);
            return reply.code(200).send({ status: 'closed' });
        } catch (err) {
            return sendControllerError(reply, err);
        }
    });

    /**
     * `POST /zones/:id/run` — opens the zone now and schedules an automatic
     * close after `durationMin` minutes. Body must contain a positive finite
     * `durationMin`; the controller additionally caps it at
     * `MAX_RUN_DURATION_MIN`. Maps controller errors: `BusyError` → 409,
     * duration out-of-range → 400, anything else (HA failure) → 502.
     */
    app.post('/zones/:id/run', async (req, reply) => {
        const { id } = req.params as { id: string };
        const body = req.body as Record<string, unknown> | undefined;
        const durationMin = body?.['durationMin'];
        if (typeof durationMin !== 'number' || !Number.isFinite(durationMin) || durationMin <= 0) {
            return reply.code(400).send({ error: 'bad-request', message: 'durationMin must be a positive number.' });
        }

        const zone = await zoneById(id);
        if (!zone) return reply.code(404).send({ error: 'not-found', message: `Zone ${id} not found.` });

        try {
            const { since, willCloseAt } = await manual.run(zone, durationMin);
            return reply.code(200).send({
                status: 'open',
                since: since.toISOString(),
                willCloseAt: willCloseAt.toISOString(),
            });
        } catch (err) {
            // Map controller-side durationMin validation (e.g. "exceeds maximum") back to 400
            // so the client sees the same status class as the route's own pre-check above.
            if (err instanceof Error && /durationMin/.test(err.message)) {
                return reply.code(400).send({ error: 'bad-request', message: err.message });
            }
            return sendControllerError(reply, err);
        }
    });
}

export function sendControllerError(reply: FastifyReply, err: unknown): FastifyReply {
    if (err instanceof SystemDisabledError) {
        return reply.code(409).send({ error: 'system-disabled', message: err.message });
    }
    if (err instanceof BusyError) {
        return reply.code(409).send({ error: 'busy', message: err.message });
    }
    const message = err instanceof Error ? err.message : String(err);
    return reply.code(502).send({ error: 'home-assistant', message });
}
