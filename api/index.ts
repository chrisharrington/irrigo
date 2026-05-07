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

    app.get('/', async () => {
        return { message: 'Hello, world!' };
    });

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
            // Validation errors thrown by `run` (durationMin out of range) → 400.
            // Concurrency rejections → 409. HA / IO errors → 502.
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
