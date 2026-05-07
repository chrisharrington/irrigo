import Fastify, { type FastifyInstance } from 'fastify';
import Config from '@/config';
import { start as daemonStart, type DaemonControl, type DaemonDb, type DaemonStatus } from '@/daemon';
import { createNotifier } from '@/notifications';

const shutdownStarted = new WeakSet<FastifyInstance>();

/**
 * Builds the Fastify instance with the routes Irrigo exposes today. The status
 * getter is injected so tests can pass a stub without a running daemon.
 */
export function buildApp(opts: { getStatus: () => DaemonStatus }): FastifyInstance {
    const app = Fastify();

    app.get('/', async () => {
        return { message: 'Hello, world!' };
    });

    app.get('/health', async () => {
        return opts.getStatus();
    });

    return app;
}

/**
 * Closes the daemon (relays first) before the HTTP server. Idempotent per app
 * so the SIGINT/SIGTERM handlers can both fire without double-closing.
 */
export async function gracefulShutdown(app: FastifyInstance, daemon: DaemonControl): Promise<void> {
    if (shutdownStarted.has(app)) return;
    shutdownStarted.add(app);
    console.log('shutdown: starting; closing daemon before HTTP.');
    await daemon.shutdown();
    await app.close();
    console.log('shutdown: complete.');
}

if (import.meta.main) {
    const { db } = await import('@/db');
    const notifier = createNotifier();
    const daemon = await daemonStart(db as unknown as DaemonDb, { notifier });
    const app = buildApp({ getStatus: daemon.getStatus });

    const onSignal = (signal: NodeJS.Signals): void => {
        console.log(`process: received ${signal}; shutting down.`);
        gracefulShutdown(app, daemon)
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
