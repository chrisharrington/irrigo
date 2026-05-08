import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import Config from '@/config';
import { start as daemonStart, type DaemonControl, type DaemonDb, type DaemonStatus } from '@/daemon';
import { realClock } from '@/daemon/runtime';
import { loadZoneById } from '@/daemon/zones';
import { closeZone, openZone } from '@/data/home-assistant';
import { BusyError, createManualController, type ManualController } from '@/manual';
import type { Zone } from '@/models';
import { createNotifier } from '@/notifications';

const shutdownStarted = new WeakSet<FastifyInstance>();

/**
 * Build-time options for the Fastify app. `manual` and `zoneById` are
 * optional so tests that only care about `/` and `/health` don't have to
 * stub the manual surface.
 */
export type BuildAppOptions = {
    getStatus: () => DaemonStatus;
    manual?: ManualController;
    zoneById?: (zoneId: string) => Promise<Zone | null>;
};

/**
 * Builds the Fastify instance with the routes Irrigo exposes today. Status
 * and the manual-fire controller are injected so tests can substitute stubs
 * without a running daemon or DB.
 */
export function buildApp(opts: BuildAppOptions): FastifyInstance {
    const app = Fastify();

    /**
     * `GET /` — placeholder root-of-host probe. Always 200; useful for
     * confirming the api process is up before pointing tooling at it.
     */
    app.get('/', async () => {
        return { message: 'Hello, world!' };
    });

    /**
     * `GET /health` — daemon liveness snapshot for ops surfaces. Re-evaluates
     * `getStatus()` per request so a long-lived monitor sees state changes
     * (re-plan timestamp updates, in-flight zones changing) without restarts.
     */
    app.get('/health', async () => {
        return opts.getStatus();
    });

    if (opts.manual && opts.zoneById) {
        registerManualRoutes(app, opts.manual, opts.zoneById);
    }

    return app;
}

function registerManualRoutes(
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

function sendControllerError(reply: FastifyReply, err: unknown): FastifyReply {
    if (err instanceof BusyError) {
        return reply.code(409).send({ error: 'busy', message: err.message });
    }
    const message = err instanceof Error ? err.message : String(err);
    return reply.code(502).send({ error: 'home-assistant', message });
}

/**
 * Closes the manual relay (if any), then the daemon, then the HTTP server.
 * Idempotent per app so the SIGINT/SIGTERM handlers can both fire without
 * double-closing.
 */
export async function gracefulShutdown(
    app: FastifyInstance,
    daemon: DaemonControl,
    manual?: ManualController,
): Promise<void> {
    if (shutdownStarted.has(app)) return;
    shutdownStarted.add(app);
    console.log('shutdown: starting; closing manual relay (if any) and daemon before HTTP.');
    if (manual) await manual.shutdown();
    await daemon.shutdown();
    await app.close();
    console.log('shutdown: complete.');
}

if (import.meta.main) {
    const { db } = await import('@/db');
    const notifier = createNotifier();
    const daemon = await daemonStart(db as unknown as DaemonDb, { notifier });
    const manual = createManualController({
        db: db as unknown as Parameters<typeof createManualController>[0]['db'],
        clock: realClock,
        openZone,
        closeZone,
        notifier,
        isAnyScheduledInFlight: () => daemon.getStatus().activeZones.length > 0,
    });
    const app = buildApp({
        getStatus: daemon.getStatus,
        manual,
        zoneById: zoneId => loadZoneById(db as unknown as Parameters<typeof loadZoneById>[0], zoneId),
    });

    const onSignal = (signal: NodeJS.Signals): void => {
        console.log(`process: received ${signal}; shutting down.`);
        gracefulShutdown(app, daemon, manual)
            .then(() => process.exit(0))
            .catch(err => {
                console.error('shutdown: failed.', err);
                process.exit(1);
            });
    };

    process.on('SIGINT', onSignal);
    process.on('SIGTERM', onSignal);

    process.on('uncaughtException', err => {
        console.error('process: uncaughtException; HTTP server staying up.', err);
    });
    process.on('unhandledRejection', reason => {
        console.error('process: unhandledRejection; HTTP server staying up.', reason);
    });

    try {
        await app.listen({ port: Config.port, host: '0.0.0.0' });
        console.log(`Server is running on listening on port ${Config.port}.`);
    } catch (err) {
        app.log.error(err);
        process.exit(1);
    }
}
