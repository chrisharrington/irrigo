import { describe, it, expect } from 'bun:test';
import { buildApp, gracefulShutdown } from '@/index';
import type { DaemonControl, DaemonStatus } from '@/daemon';

function buildStatus(overrides?: Partial<DaemonStatus>): DaemonStatus {
    return {
        alive: true,
        lastRePlanAt: null,
        activeZones: [],
        ...overrides,
    };
}

describe('buildApp GET /', () => {
    it('returns the hello-world payload', async () => {
        const app = buildApp({ getStatus: () => buildStatus() });

        const res = await app.inject({ method: 'GET', url: '/' });

        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ message: 'Hello, world!' });
        await app.close();
    });
});

describe('buildApp GET /health', () => {
    it('returns the daemon status verbatim with status 200', async () => {
        const status = buildStatus({
            alive: true,
            lastRePlanAt: '2026-05-04T12:00:00.000Z',
            activeZones: [{ id: 'zone-001', name: 'Front Lawn' }],
        });
        const app = buildApp({ getStatus: () => status });

        const res = await app.inject({ method: 'GET', url: '/health' });

        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual(status);
        await app.close();
    });

    it('re-evaluates the status getter on each request rather than memoizing', async () => {
        let alive = false;
        const app = buildApp({ getStatus: () => buildStatus({ alive }) });

        const before = await app.inject({ method: 'GET', url: '/health' });
        expect(before.json()).toMatchObject({ alive: false });

        alive = true;
        const after = await app.inject({ method: 'GET', url: '/health' });
        expect(after.json()).toMatchObject({ alive: true });
        await app.close();
    });
});

describe('gracefulShutdown', () => {
    function buildFakeDaemon(callOrder: string[]): DaemonControl {
        return {
            rePlan: async () => {},
            shutdown: async () => { callOrder.push('daemon'); },
            getStatus: () => buildStatus(),
        };
    }

    it('shuts down the daemon before closing the Fastify server', async () => {
        const callOrder: string[] = [];
        const daemon = buildFakeDaemon(callOrder);
        const app = buildApp({ getStatus: daemon.getStatus });
        const originalClose = app.close.bind(app);
        app.close = (async () => {
            callOrder.push('fastify');
            await originalClose();
        }) as typeof app.close;

        await gracefulShutdown(app, daemon);

        expect(callOrder).toEqual(['daemon', 'fastify']);
    });

    it('is idempotent: a second invocation skips the shutdown work', async () => {
        const callOrder: string[] = [];
        const daemon = buildFakeDaemon(callOrder);
        const app = buildApp({ getStatus: daemon.getStatus });
        const originalClose = app.close.bind(app);
        app.close = (async () => {
            callOrder.push('fastify');
            await originalClose();
        }) as typeof app.close;

        await gracefulShutdown(app, daemon);
        await gracefulShutdown(app, daemon);

        expect(callOrder).toEqual(['daemon', 'fastify']);
    });
});
