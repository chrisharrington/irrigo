import { describe, it, expect } from 'bun:test';
import { buildApp, gracefulShutdown, wrapScheduleWithReplan, type ScheduleApi } from '@/index';
import type { DaemonControl, DaemonStatus } from '@/daemon';
import type { ZoneSummary } from '@/daemon/zones';
import { BusyError, type ManualController } from '@/manual';
import type { Zone } from '@/models';

function buildStatus(overrides?: Partial<DaemonStatus>): DaemonStatus {
    return {
        alive: true,
        lastRePlanAt: null,
        activeZones: [],
        ...overrides,
    };
}

function buildZone(overrides?: Partial<Zone>): Zone {
    return {
        id: 'zone-001',
        name: 'Front Lawn',
        grassType: { name: 'Kentucky Bluegrass', cropCoefficient: 0.85 },
        soil: { name: 'Loam', availableWaterHoldingCapacityMmPerM: 150, infiltrationRateMmPerHr: 25 },
        rootDepthM: 0.3,
        allowableDepletionFraction: 0.5,
        irrigationEfficiency: 0.8,
        flowRateLPerMin: 15,
        areaM2: 100,
        precipitationRateMmPerHr: 9,
        currentDepletionMm: 12,
        siteId: 'site-A',
        siteTimezone: 'America/Edmonton',
        isEnabled: true,
        homeAssistantEntityId: 'switch.zone_001',
        ...overrides,
    };
}

function buildManual(overrides?: Partial<ManualController>): ManualController {
    return {
        open: async () => ({ since: new Date('2026-05-04T15:00:00.000Z') }),
        close: async () => ({ closed: true }),
        run: async () => ({
            since: new Date('2026-05-04T15:00:00.000Z'),
            willCloseAt: new Date('2026-05-04T15:15:00.000Z'),
        }),
        getActiveZone: () => null,
        shutdown: async () => {},
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

    it('shuts down the manual controller before the daemon when one is provided', async () => {
        const callOrder: string[] = [];
        const daemon = buildFakeDaemon(callOrder);
        const manual = buildManual({ shutdown: async () => { callOrder.push('manual'); } });
        const app = buildApp({ getStatus: daemon.getStatus });
        const originalClose = app.close.bind(app);
        app.close = (async () => {
            callOrder.push('fastify');
            await originalClose();
        }) as typeof app.close;

        await gracefulShutdown(app, daemon, manual);

        expect(callOrder).toEqual(['manual', 'daemon', 'fastify']);
    });
});

describe('buildApp manual zone routes', () => {
    function buildAppWithManual(opts?: {
        manual?: ManualController;
        zoneById?: (zoneId: string) => Promise<Zone | null>;
    }) {
        return buildApp({
            getStatus: () => buildStatus(),
            manual: opts?.manual ?? buildManual(),
            zoneById: opts?.zoneById ?? (async (id) => id === 'zone-001' ? buildZone() : null),
        });
    }

    describe('POST /zones/:id/open', () => {
        it('returns 200 with the open timestamp on success', async () => {
            const app = buildAppWithManual();

            const res = await app.inject({ method: 'POST', url: '/zones/zone-001/open' });

            expect(res.statusCode).toBe(200);
            expect(res.json()).toEqual({ status: 'open', since: '2026-05-04T15:00:00.000Z' });
            await app.close();
        });

        it('returns 404 when the zone is not found', async () => {
            const app = buildAppWithManual();

            const res = await app.inject({ method: 'POST', url: '/zones/zone-missing/open' });

            expect(res.statusCode).toBe(404);
            expect(res.json()).toMatchObject({ error: 'not-found' });
            await app.close();
        });

        it('returns 409 when the controller throws BusyError', async () => {
            const app = buildAppWithManual({
                manual: buildManual({ open: async () => { throw new BusyError('busy'); } }),
            });

            const res = await app.inject({ method: 'POST', url: '/zones/zone-001/open' });

            expect(res.statusCode).toBe(409);
            expect(res.json()).toMatchObject({ error: 'busy' });
            await app.close();
        });

        it('returns 502 when the controller throws a non-busy error (HA failure)', async () => {
            const app = buildAppWithManual({
                manual: buildManual({ open: async () => { throw new Error('HA 502'); } }),
            });

            const res = await app.inject({ method: 'POST', url: '/zones/zone-001/open' });

            expect(res.statusCode).toBe(502);
            expect(res.json()).toMatchObject({ error: 'home-assistant', message: 'HA 502' });
            await app.close();
        });
    });

    describe('POST /zones/:id/close', () => {
        it('returns 200 on success (controller is idempotent)', async () => {
            const app = buildAppWithManual();

            const res = await app.inject({ method: 'POST', url: '/zones/zone-001/close' });

            expect(res.statusCode).toBe(200);
            expect(res.json()).toEqual({ status: 'closed' });
            await app.close();
        });

        it('returns 404 when the zone is not found', async () => {
            const app = buildAppWithManual();

            const res = await app.inject({ method: 'POST', url: '/zones/zone-missing/close' });

            expect(res.statusCode).toBe(404);
            await app.close();
        });

        it('returns 502 when the controller throws a non-busy error', async () => {
            const app = buildAppWithManual({
                manual: buildManual({ close: async () => { throw new Error('HA 504'); } }),
            });

            const res = await app.inject({ method: 'POST', url: '/zones/zone-001/close' });

            expect(res.statusCode).toBe(502);
            await app.close();
        });
    });

    describe('POST /zones/:id/run', () => {
        it('returns 200 with since and willCloseAt for a valid duration', async () => {
            const app = buildAppWithManual();

            const res = await app.inject({
                method: 'POST',
                url: '/zones/zone-001/run',
                payload: { durationMin: 15 },
                headers: { 'content-type': 'application/json' },
            });

            expect(res.statusCode).toBe(200);
            expect(res.json()).toEqual({
                status: 'open',
                since: '2026-05-04T15:00:00.000Z',
                willCloseAt: '2026-05-04T15:15:00.000Z',
            });
            await app.close();
        });

        it('returns 400 when the body is missing or has no durationMin', async () => {
            const app = buildAppWithManual();

            const noBody = await app.inject({ method: 'POST', url: '/zones/zone-001/run' });
            expect(noBody.statusCode).toBe(400);

            const emptyBody = await app.inject({
                method: 'POST',
                url: '/zones/zone-001/run',
                payload: {},
                headers: { 'content-type': 'application/json' },
            });
            expect(emptyBody.statusCode).toBe(400);
            await app.close();
        });

        it('returns 400 when durationMin is non-numeric, zero, or negative', async () => {
            const app = buildAppWithManual();

            for (const bad of [{ durationMin: 'fifteen' }, { durationMin: 0 }, { durationMin: -5 }]) {
                const res = await app.inject({
                    method: 'POST',
                    url: '/zones/zone-001/run',
                    payload: bad,
                    headers: { 'content-type': 'application/json' },
                });
                expect(res.statusCode).toBe(400);
            }
            await app.close();
        });

        it('returns 400 when durationMin exceeds the controller cap', async () => {
            const app = buildAppWithManual({
                manual: buildManual({
                    run: async () => { throw new Error('manual: durationMin 999 exceeds maximum 60.'); },
                }),
            });

            const res = await app.inject({
                method: 'POST',
                url: '/zones/zone-001/run',
                payload: { durationMin: 999 },
                headers: { 'content-type': 'application/json' },
            });

            expect(res.statusCode).toBe(400);
            expect(res.json()).toMatchObject({ error: 'bad-request' });
            await app.close();
        });

        it('returns 409 when the controller throws BusyError', async () => {
            const app = buildAppWithManual({
                manual: buildManual({ run: async () => { throw new BusyError('busy'); } }),
            });

            const res = await app.inject({
                method: 'POST',
                url: '/zones/zone-001/run',
                payload: { durationMin: 5 },
                headers: { 'content-type': 'application/json' },
            });

            expect(res.statusCode).toBe(409);
            await app.close();
        });

        it('returns 502 when the controller throws a non-validation, non-busy error', async () => {
            const app = buildAppWithManual({
                manual: buildManual({ run: async () => { throw new Error('HA 504'); } }),
            });

            const res = await app.inject({
                method: 'POST',
                url: '/zones/zone-001/run',
                payload: { durationMin: 5 },
                headers: { 'content-type': 'application/json' },
            });

            expect(res.statusCode).toBe(502);
            expect(res.json()).toMatchObject({ error: 'home-assistant', message: 'HA 504' });
            await app.close();
        });

        it('returns 404 when the zone is not found', async () => {
            const app = buildAppWithManual();

            const res = await app.inject({
                method: 'POST',
                url: '/zones/zone-missing/run',
                payload: { durationMin: 5 },
                headers: { 'content-type': 'application/json' },
            });

            expect(res.statusCode).toBe(404);
            await app.close();
        });
    });

    describe('without a manual controller', () => {
        it('does not register the manual routes when manual or zoneById is missing', async () => {
            const app = buildApp({ getStatus: () => buildStatus() });

            const res = await app.inject({ method: 'POST', url: '/zones/zone-001/open' });

            expect(res.statusCode).toBe(404);
            await app.close();
        });
    });
});

describe('buildApp schedule routes', () => {
    const NOW = new Date('2026-05-08T12:00:00.000Z');
    const buildSchedule = (overrides?: Partial<{ slug: string; name: string; siteId: string; isActive: boolean }>) => ({
        id: 'sched-1',
        siteId: 'site-A',
        slug: 'maintenance',
        name: 'Maintenance',
        isActive: true,
        createdAt: NOW,
        updatedAt: NOW,
        ...overrides,
    });

    describe('POST /schedule/enable/:slug', () => {
        it('returns 200 with the schedule payload on success', async () => {
            const app = buildApp({
                getStatus: () => buildStatus(),
                schedule: {
                    enable: async slug => buildSchedule({ slug, name: 'Maintenance', siteId: 'site-A', isActive: true }),
                    disable: async () => null,
                },
            });

            const res = await app.inject({ method: 'POST', url: '/schedule/enable/maintenance' });

            expect(res.statusCode).toBe(200);
            expect(res.json()).toEqual({
                status: 'enabled',
                schedule: { slug: 'maintenance', name: 'Maintenance', siteId: 'site-A' },
            });
            await app.close();
        });

        it('returns 404 when the controller returns null', async () => {
            const app = buildApp({
                getStatus: () => buildStatus(),
                schedule: { enable: async () => null, disable: async () => null },
            });

            const res = await app.inject({ method: 'POST', url: '/schedule/enable/no-such' });

            expect(res.statusCode).toBe(404);
            expect(res.json()).toMatchObject({ error: 'not-found' });
            await app.close();
        });
    });

    describe('POST /schedule/disable/:slug', () => {
        it('returns 200 with the schedule payload on success', async () => {
            const app = buildApp({
                getStatus: () => buildStatus(),
                schedule: {
                    enable: async () => null,
                    disable: async slug => buildSchedule({ slug, isActive: false }),
                },
            });

            const res = await app.inject({ method: 'POST', url: '/schedule/disable/maintenance' });

            expect(res.statusCode).toBe(200);
            expect(res.json()).toMatchObject({
                status: 'disabled',
                schedule: { slug: 'maintenance' },
            });
            await app.close();
        });

        it('returns 404 when the controller returns null', async () => {
            const app = buildApp({
                getStatus: () => buildStatus(),
                schedule: { enable: async () => null, disable: async () => null },
            });

            const res = await app.inject({ method: 'POST', url: '/schedule/disable/no-such' });

            expect(res.statusCode).toBe(404);
            await app.close();
        });
    });

    it('does not register schedule routes when the option is absent', async () => {
        const app = buildApp({ getStatus: () => buildStatus() });

        const res = await app.inject({ method: 'POST', url: '/schedule/enable/maintenance' });

        expect(res.statusCode).toBe(404);
        await app.close();
    });

    describe('wrapped with replan', () => {
        it('returns 502 when the wrapped enable closure rejects (re-plan failed)', async () => {
            // Simulate the production wiring: enable throws because replan threw.
            const base: ScheduleApi = {
                enable: async slug => buildSchedule({ slug }),
                disable: async () => null,
            };
            const wrapped = wrapScheduleWithReplan(base, async () => { throw new Error('HA 503'); });
            const app = buildApp({ getStatus: () => buildStatus(), schedule: wrapped });

            const res = await app.inject({ method: 'POST', url: '/schedule/enable/maintenance' });

            expect(res.statusCode).toBe(502);
            expect(res.json()).toMatchObject({ error: 'replan-failed', message: 'HA 503' });
            await app.close();
        });

        it('returns 502 when the wrapped disable closure rejects', async () => {
            const base: ScheduleApi = {
                enable: async () => null,
                disable: async slug => buildSchedule({ slug, isActive: false }),
            };
            const wrapped = wrapScheduleWithReplan(base, async () => { throw new Error('HA 504'); });
            const app = buildApp({ getStatus: () => buildStatus(), schedule: wrapped });

            const res = await app.inject({ method: 'POST', url: '/schedule/disable/maintenance' });

            expect(res.statusCode).toBe(502);
            expect(res.json()).toMatchObject({ error: 'replan-failed', message: 'HA 504' });
            await app.close();
        });
    });
});

describe('wrapScheduleWithReplan', () => {
    const buildSchedule = (overrides?: Partial<{ slug: string; name: string; siteId: string; isActive: boolean }>) => ({
        id: 'sched-1',
        siteId: 'site-A',
        slug: 'maintenance',
        name: 'Maintenance',
        isActive: true,
        allowedDays: null,
        allowedTimeWindows: null,
        rootDepthMOverride: null,
        allowableDepletionFractionOverride: null,
        createdAt: new Date('2026-05-11T18:00:00.000Z'),
        updatedAt: new Date('2026-05-11T18:00:00.000Z'),
        ...overrides,
    });

    it('calls replan after a non-null enable result, awaiting it before returning', async () => {
        const callOrder: string[] = [];
        const base: ScheduleApi = {
            enable: async (slug) => { callOrder.push('enable'); return buildSchedule({ slug }); },
            disable: async () => null,
        };
        const replan = async () => {
            await Promise.resolve();
            callOrder.push('replan');
        };
        const wrapped = wrapScheduleWithReplan(base, replan);

        const result = await wrapped.enable('maintenance');
        callOrder.push('returned');

        expect(result?.slug).toBe('maintenance');
        expect(callOrder).toEqual(['enable', 'replan', 'returned']);
    });

    it('skips replan when enable returns null (unknown slug)', async () => {
        let replanCalls = 0;
        const base: ScheduleApi = {
            enable: async () => null,
            disable: async () => null,
        };
        const wrapped = wrapScheduleWithReplan(base, async () => { replanCalls += 1; });

        const result = await wrapped.enable('no-such');

        expect(result).toBeNull();
        expect(replanCalls).toBe(0);
    });

    it('calls replan after a non-null disable result', async () => {
        const callOrder: string[] = [];
        const base: ScheduleApi = {
            enable: async () => null,
            disable: async (slug) => { callOrder.push('disable'); return buildSchedule({ slug, isActive: false }); },
        };
        const wrapped = wrapScheduleWithReplan(base, async () => { callOrder.push('replan'); });

        await wrapped.disable('maintenance');

        expect(callOrder).toEqual(['disable', 'replan']);
    });

    it('skips replan when disable returns null', async () => {
        let replanCalls = 0;
        const base: ScheduleApi = {
            enable: async () => null,
            disable: async () => null,
        };
        const wrapped = wrapScheduleWithReplan(base, async () => { replanCalls += 1; });

        await wrapped.disable('no-such');

        expect(replanCalls).toBe(0);
    });

    it('propagates rejections from replan so the route handler can map them to 502', async () => {
        const base: ScheduleApi = {
            enable: async (slug) => buildSchedule({ slug }),
            disable: async () => null,
        };
        const wrapped = wrapScheduleWithReplan(base, async () => { throw new Error('replan failed'); });

        await expect(wrapped.enable('maintenance')).rejects.toThrow('replan failed');
    });
});

describe('buildApp /replan route', () => {
    const NOW_ISO = '2026-05-11T18:00:00.000Z';

    it('returns 200 with lastRePlanAt from getStatus after the replan resolves', async () => {
        let replanCalls = 0;
        const replan = async () => { replanCalls += 1; };
        const app = buildApp({
            getStatus: () => buildStatus({ lastRePlanAt: NOW_ISO }),
            replan,
        });

        const res = await app.inject({ method: 'POST', url: '/replan' });

        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ status: 'replanned', lastRePlanAt: NOW_ISO });
        expect(replanCalls).toBe(1);
        await app.close();
    });

    it('returns 502 with error: replan-failed when the supplied replan rejects', async () => {
        const replan = async () => { throw new Error('weather API timeout'); };
        const app = buildApp({
            getStatus: () => buildStatus(),
            replan,
        });

        const res = await app.inject({ method: 'POST', url: '/replan' });

        expect(res.statusCode).toBe(502);
        expect(res.json()).toMatchObject({ error: 'replan-failed', message: 'weather API timeout' });
        await app.close();
    });

    it('does not register /replan when the option is absent', async () => {
        const app = buildApp({ getStatus: () => buildStatus() });

        const res = await app.inject({ method: 'POST', url: '/replan' });

        expect(res.statusCode).toBe(404);
        await app.close();
    });
});

describe('buildApp GET /zones', () => {
    function buildSummary(overrides?: Partial<ZoneSummary>): ZoneSummary {
        return {
            id: 'zone-001',
            slug: 'north',
            name: 'North',
            isEnabled: true,
            grassType: { name: 'Kentucky Bluegrass' },
            soilType: { name: 'Clay Loam' },
            areaM2: 80,
            rootDepthM: 0.3,
            allowableDepletionFraction: 0.5,
            irrigationEfficiency: 0.675,
            microclimateFactor: 0.85,
            precipitationRateMmPerHr: null,
            currentDepletionMm: 12.4,
            rawMm: 21,
            lastFiredAt: '2026-05-13',
            lastAppliedMm: 14,
            homeAssistantEntityId: 'switch.sprinkler_controller_north_zone',
            patch: 'a',
            ...overrides,
        };
    }

    it('returns 200 with the wrapped zones array from the loader', async () => {
        const summaries = [
            buildSummary({ id: 'zone-001', slug: 'north', name: 'North' }),
            buildSummary({ id: 'zone-002', slug: 'south', name: 'South', patch: 'b' }),
        ];
        const app = buildApp({
            getStatus: () => buildStatus(),
            zonesSummary: async () => summaries,
        });

        const res = await app.inject({ method: 'GET', url: '/zones' });

        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ zones: summaries });
        await app.close();
    });

    it('returns 200 with an empty array when no zones exist', async () => {
        const app = buildApp({
            getStatus: () => buildStatus(),
            zonesSummary: async () => [],
        });

        const res = await app.inject({ method: 'GET', url: '/zones' });

        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ zones: [] });
        await app.close();
    });

    it('does not register the route when zonesSummary is omitted', async () => {
        const app = buildApp({ getStatus: () => buildStatus() });

        const res = await app.inject({ method: 'GET', url: '/zones' });

        expect(res.statusCode).toBe(404);
        await app.close();
    });

    it('re-evaluates the loader on each request rather than memoizing', async () => {
        let counter = 0;
        const app = buildApp({
            getStatus: () => buildStatus(),
            zonesSummary: async () => {
                counter++;
                return [buildSummary({ id: `call-${counter}` })];
            },
        });

        const first = await app.inject({ method: 'GET', url: '/zones' });
        const second = await app.inject({ method: 'GET', url: '/zones' });

        expect(first.json()).toMatchObject({ zones: [{ id: 'call-1' }] });
        expect(second.json()).toMatchObject({ zones: [{ id: 'call-2' }] });
        await app.close();
    });
});
