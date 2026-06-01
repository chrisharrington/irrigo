import { describe, it, expect } from 'bun:test';
import type { ActivityDto, ActivityListParams, ActivityListResult } from '@/activity';
import { encodeCursor } from '@/util/cursor';
import type { AlertDto } from '@/alerts';
import { buildApp, gracefulShutdown, readExpoAccessToken, wrapScheduleWithReplan, wrapSystemWithReplan, type ScheduleApi, type SystemApi } from '@/index';
import type { TonightDto } from '@/models/tonight';
import type { ScheduleListItem } from '@/service/schedules-list';
import type { DaemonControl, DaemonStatus } from '@/service/daemon';
import type { ZoneSummary } from '@/models/zone';
import { BusyError, SystemDisabledError, type ManualController } from '@/service/manual';
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

        it('returns 409 with system-disabled when the controller throws SystemDisabledError', async () => {
            const app = buildAppWithManual({
                manual: buildManual({ open: async () => { throw new SystemDisabledError('manual: irrigation is disabled.'); } }),
            });

            const res = await app.inject({ method: 'POST', url: '/zones/zone-001/open' });

            expect(res.statusCode).toBe(409);
            expect(res.json()).toMatchObject({ error: 'system-disabled', message: 'manual: irrigation is disabled.' });
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

        it('returns 409 with system-disabled when the controller throws SystemDisabledError', async () => {
            const app = buildAppWithManual({
                manual: buildManual({ run: async () => { throw new SystemDisabledError('manual: irrigation is disabled.'); } }),
            });

            const res = await app.inject({
                method: 'POST',
                url: '/zones/zone-001/run',
                payload: { durationMin: 5 },
                headers: { 'content-type': 'application/json' },
            });

            expect(res.statusCode).toBe(409);
            expect(res.json()).toMatchObject({ error: 'system-disabled' });
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
    const buildSchedule = (overrides?: Partial<{ slug: string; name: string; siteId: string; isActive: boolean; skippedNightDate: string | null }>) => ({
        id: 'sched-1',
        siteId: 'site-A',
        slug: 'maintenance',
        name: 'Maintenance',
        isActive: true,
        skippedNightDate: null as string | null,
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

    describe('POST /schedule/skip-tonight', () => {
        it('returns 200 with the post-update schedule on success', async () => {
            const app = buildApp({
                getStatus: () => buildStatus(),
                schedule: {
                    enable: async () => null,
                    disable: async () => null,
                    skipTonight: async () => buildSchedule({ slug: 'maintenance', name: 'Maintenance', siteId: 'site-A', skippedNightDate: '2026-05-20' }),
                    resumeTonight: async () => null,
                },
            });

            const res = await app.inject({ method: 'POST', url: '/schedule/skip-tonight' });

            expect(res.statusCode).toBe(200);
            expect(res.json()).toEqual({
                status: 'skipped',
                schedule: { slug: 'maintenance', name: 'Maintenance', siteId: 'site-A', skippedNightDate: '2026-05-20' },
            });
            await app.close();
        });

        it('returns 404 when no schedule is active', async () => {
            const app = buildApp({
                getStatus: () => buildStatus(),
                schedule: {
                    enable: async () => null,
                    disable: async () => null,
                    skipTonight: async () => null,
                    resumeTonight: async () => null,
                },
            });

            const res = await app.inject({ method: 'POST', url: '/schedule/skip-tonight' });

            expect(res.statusCode).toBe(404);
            expect(res.json()).toMatchObject({ error: 'not-found' });
            await app.close();
        });

        it('returns 502 when the wrapped re-plan rejects', async () => {
            const base: ScheduleApi = {
                enable: async () => null,
                disable: async () => null,
                skipTonight: async () => buildSchedule({ skippedNightDate: '2026-05-20' }),
                resumeTonight: async () => null,
            };
            const wrapped = wrapScheduleWithReplan(base, async () => { throw new Error('HA 503'); });
            const app = buildApp({ getStatus: () => buildStatus(), schedule: wrapped });

            const res = await app.inject({ method: 'POST', url: '/schedule/skip-tonight' });

            expect(res.statusCode).toBe(502);
            expect(res.json()).toMatchObject({ error: 'replan-failed', message: 'HA 503' });
            await app.close();
        });
    });

    describe('POST /schedule/resume-tonight', () => {
        it('returns 200 with the cleared schedule on success', async () => {
            const app = buildApp({
                getStatus: () => buildStatus(),
                schedule: {
                    enable: async () => null,
                    disable: async () => null,
                    skipTonight: async () => null,
                    resumeTonight: async () => buildSchedule({ slug: 'maintenance', name: 'Maintenance', siteId: 'site-A', skippedNightDate: null }),
                },
            });

            const res = await app.inject({ method: 'POST', url: '/schedule/resume-tonight' });

            expect(res.statusCode).toBe(200);
            expect(res.json()).toEqual({
                status: 'resumed',
                schedule: { slug: 'maintenance', name: 'Maintenance', siteId: 'site-A', skippedNightDate: null },
            });
            await app.close();
        });

        it('is idempotent: returns 200 even when the marker was already null', async () => {
            // The handler returns the row with skippedNightDate:null whether or not it
            // was previously set; the route should treat that as success, not a no-op
            // failure.
            const app = buildApp({
                getStatus: () => buildStatus(),
                schedule: {
                    enable: async () => null,
                    disable: async () => null,
                    skipTonight: async () => null,
                    resumeTonight: async () => buildSchedule({ skippedNightDate: null }),
                },
            });

            const res = await app.inject({ method: 'POST', url: '/schedule/resume-tonight' });

            expect(res.statusCode).toBe(200);
            expect(res.json()).toMatchObject({ status: 'resumed' });
            await app.close();
        });

        it('returns 404 when no schedule is active', async () => {
            const app = buildApp({
                getStatus: () => buildStatus(),
                schedule: {
                    enable: async () => null,
                    disable: async () => null,
                    skipTonight: async () => null,
                    resumeTonight: async () => null,
                },
            });

            const res = await app.inject({ method: 'POST', url: '/schedule/resume-tonight' });

            expect(res.statusCode).toBe(404);
            await app.close();
        });

        it('returns 502 when the wrapped re-plan rejects', async () => {
            const base: ScheduleApi = {
                enable: async () => null,
                disable: async () => null,
                skipTonight: async () => null,
                resumeTonight: async () => buildSchedule({ skippedNightDate: null }),
            };
            const wrapped = wrapScheduleWithReplan(base, async () => { throw new Error('HA 504'); });
            const app = buildApp({ getStatus: () => buildStatus(), schedule: wrapped });

            const res = await app.inject({ method: 'POST', url: '/schedule/resume-tonight' });

            expect(res.statusCode).toBe(502);
            expect(res.json()).toMatchObject({ error: 'replan-failed', message: 'HA 504' });
            await app.close();
        });
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
    const buildSchedule = (overrides?: Partial<{ slug: string; name: string; siteId: string; isActive: boolean; skippedNightDate: string | null }>) => ({
        id: 'sched-1',
        siteId: 'site-A',
        slug: 'maintenance',
        name: 'Maintenance',
        isActive: true,
        allowedDays: null,
        allowedTimeWindows: null,
        rootDepthMOverride: null,
        allowableDepletionFractionOverride: null,
        skippedNightDate: null as string | null,
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
            skipTonight: async () => null,
            resumeTonight: async () => null,
        };
        const wrapped = wrapScheduleWithReplan(base, async () => { throw new Error('replan failed'); });

        await expect(wrapped.enable('maintenance')).rejects.toThrow('replan failed');
    });

    it('calls replan after a non-null skipTonight result, awaiting it before returning', async () => {
        const callOrder: string[] = [];
        const base: ScheduleApi = {
            enable: async () => null,
            disable: async () => null,
            skipTonight: async () => { callOrder.push('skip'); return buildSchedule({ skippedNightDate: '2026-05-20' }); },
            resumeTonight: async () => null,
        };
        const wrapped = wrapScheduleWithReplan(base, async () => {
            await Promise.resolve();
            callOrder.push('replan');
        });

        const result = await wrapped.skipTonight();
        callOrder.push('returned');

        expect(result?.skippedNightDate).toBe('2026-05-20');
        expect(callOrder).toEqual(['skip', 'replan', 'returned']);
    });

    it('skips replan when skipTonight returns null (no active schedule)', async () => {
        let replanCalls = 0;
        const base: ScheduleApi = {
            enable: async () => null,
            disable: async () => null,
            skipTonight: async () => null,
            resumeTonight: async () => null,
        };
        const wrapped = wrapScheduleWithReplan(base, async () => { replanCalls += 1; });

        const result = await wrapped.skipTonight();

        expect(result).toBeNull();
        expect(replanCalls).toBe(0);
    });

    it('calls replan after a non-null resumeTonight result', async () => {
        const callOrder: string[] = [];
        const base: ScheduleApi = {
            enable: async () => null,
            disable: async () => null,
            skipTonight: async () => null,
            resumeTonight: async () => { callOrder.push('resume'); return buildSchedule({ skippedNightDate: null }); },
        };
        const wrapped = wrapScheduleWithReplan(base, async () => { callOrder.push('replan'); });

        await wrapped.resumeTonight();

        expect(callOrder).toEqual(['resume', 'replan']);
    });

    it('skips replan when resumeTonight returns null', async () => {
        let replanCalls = 0;
        const base: ScheduleApi = {
            enable: async () => null,
            disable: async () => null,
            skipTonight: async () => null,
            resumeTonight: async () => null,
        };
        const wrapped = wrapScheduleWithReplan(base, async () => { replanCalls += 1; });

        await wrapped.resumeTonight();

        expect(replanCalls).toBe(0);
    });

    it('propagates replan rejections through skipTonight', async () => {
        const base: ScheduleApi = {
            enable: async () => null,
            disable: async () => null,
            skipTonight: async () => buildSchedule({ skippedNightDate: '2026-05-20' }),
            resumeTonight: async () => null,
        };
        const wrapped = wrapScheduleWithReplan(base, async () => { throw new Error('replan failed'); });

        await expect(wrapped.skipTonight()).rejects.toThrow('replan failed');
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
            lastFiredAt: '2026-05-13T05:00:00.000Z',
            lastAppliedMm: 14,
            homeAssistantEntityId: 'switch.sprinkler_controller_north_zone',
            patch: 'a',
            isRunning: false,
            willCloseAt: null,
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

describe('buildApp alert routes', () => {
    function buildAlert(overrides?: Partial<AlertDto>): AlertDto {
        return {
            id: 'alert-001',
            class: 'ha-call-failed',
            tone: 'danger',
            title: 'HA close failed',
            sub: 'North · ECONNREFUSED',
            when: '2026-05-20T12:00:00.000Z',
            zoneId: 'zone-001',
            ack: false,
            ...overrides,
        };
    }

    describe('GET /alerts', () => {
        it('returns 200 with the wrapped alerts array from the loader', async () => {
            const list = [buildAlert(), buildAlert({ id: 'alert-002', class: 'weather-stale', tone: 'warn', title: 'Weather API stale', zoneId: null })];
            const app = buildApp({
                getStatus: () => buildStatus(),
                alerts: { list: async () => list, ack: async () => 'not-found' },
            });

            const res = await app.inject({ method: 'GET', url: '/alerts' });

            expect(res.statusCode).toBe(200);
            expect(res.json()).toEqual({ alerts: list });
            await app.close();
        });

        it('returns 200 with an empty array when there are no active alerts', async () => {
            const app = buildApp({
                getStatus: () => buildStatus(),
                alerts: { list: async () => [], ack: async () => 'not-found' },
            });

            const res = await app.inject({ method: 'GET', url: '/alerts' });

            expect(res.statusCode).toBe(200);
            expect(res.json()).toEqual({ alerts: [] });
            await app.close();
        });

        it('returns 404 when the alerts handler is not registered', async () => {
            const app = buildApp({ getStatus: () => buildStatus() });

            const res = await app.inject({ method: 'GET', url: '/alerts' });

            expect(res.statusCode).toBe(404);
            await app.close();
        });
    });

    describe('POST /alerts/:id/ack', () => {
        it('returns 200 with status "acked" when the alert was flipped', async () => {
            const app = buildApp({
                getStatus: () => buildStatus(),
                alerts: { list: async () => [], ack: async () => 'acked' },
            });

            const res = await app.inject({ method: 'POST', url: '/alerts/alert-001/ack' });

            expect(res.statusCode).toBe(200);
            expect(res.json()).toEqual({ status: 'acked' });
            await app.close();
        });

        it('returns 200 with status "already-acked" when the alert was previously acked (idempotent)', async () => {
            const app = buildApp({
                getStatus: () => buildStatus(),
                alerts: { list: async () => [], ack: async () => 'already-acked' },
            });

            const res = await app.inject({ method: 'POST', url: '/alerts/alert-001/ack' });

            expect(res.statusCode).toBe(200);
            expect(res.json()).toEqual({ status: 'already-acked' });
            await app.close();
        });

        it('returns 404 when the alert id is unknown', async () => {
            const app = buildApp({
                getStatus: () => buildStatus(),
                alerts: { list: async () => [], ack: async () => 'not-found' },
            });

            const res = await app.inject({ method: 'POST', url: '/alerts/alert-missing/ack' });

            expect(res.statusCode).toBe(404);
            expect(res.json()).toMatchObject({ error: 'not-found' });
            await app.close();
        });

        it('passes the route param verbatim to the ack handler', async () => {
            const acked: string[] = [];
            const app = buildApp({
                getStatus: () => buildStatus(),
                alerts: {
                    list: async () => [],
                    ack: async (id) => { acked.push(id); return 'acked'; },
                },
            });

            await app.inject({ method: 'POST', url: '/alerts/my-id-here/ack' });

            expect(acked).toEqual(['my-id-here']);
            await app.close();
        });

        it('accepts a bodyless POST with an empty Content-Type (Android RN networking) instead of 415 (APP-81)', async () => {
            // React Native's Android networking attaches an empty Content-Type
            // header to a bodyless POST, which bare Fastify rejects with
            // `415 Unsupported Media Type: undefined` before the handler runs —
            // the on-device cause of "Mark all read" silently doing nothing.
            const acked: string[] = [];
            const app = buildApp({
                getStatus: () => buildStatus(),
                alerts: {
                    list: async () => [],
                    ack: async (id) => { acked.push(id); return 'acked'; },
                },
            });

            const res = await app.inject({
                method: 'POST',
                url: '/alerts/alert-001/ack',
                headers: { 'content-type': '', 'content-length': '0' },
            });

            expect(res.statusCode).toBe(200);
            expect(res.json()).toEqual({ status: 'acked' });
            expect(acked).toEqual(['alert-001']);
            await app.close();
        });
    });
});

describe('buildApp /push routes', () => {
    type RegisterCall = { token: string; platform: 'ios' | 'android'; userAgent: string | null };

    function buildPushApp(opts?: {
        register?: (input: RegisterCall) => Promise<void>;
        unregister?: (token: string) => Promise<void>;
    }) {
        return buildApp({
            getStatus: () => buildStatus(),
            push: {
                register: opts?.register ?? (async () => {}),
                unregister: opts?.unregister ?? (async () => {}),
            },
        });
    }

    describe('POST /push/register', () => {
        it('returns 200 with status "registered" and forwards token, platform, userAgent verbatim', async () => {
            const calls: RegisterCall[] = [];
            const app = buildPushApp({ register: async (input) => { calls.push(input); } });

            const res = await app.inject({
                method: 'POST',
                url: '/push/register',
                payload: { token: 'tok-A', platform: 'ios', userAgent: 'irrigo/1.0 iOS 17' },
            });

            expect(res.statusCode).toBe(200);
            expect(res.json()).toEqual({ status: 'registered' });
            expect(calls).toEqual([{ token: 'tok-A', platform: 'ios', userAgent: 'irrigo/1.0 iOS 17' }]);
            await app.close();
        });

        it('normalises a missing userAgent to null before forwarding', async () => {
            const calls: RegisterCall[] = [];
            const app = buildPushApp({ register: async (input) => { calls.push(input); } });

            const res = await app.inject({
                method: 'POST',
                url: '/push/register',
                payload: { token: 'tok-B', platform: 'android' },
            });

            expect(res.statusCode).toBe(200);
            expect(calls[0]?.userAgent).toBeNull();
            await app.close();
        });

        it('returns 400 when token is missing', async () => {
            const app = buildPushApp();

            const res = await app.inject({
                method: 'POST',
                url: '/push/register',
                payload: { platform: 'ios' },
            });

            expect(res.statusCode).toBe(400);
            expect(res.json()).toMatchObject({ error: 'bad-request' });
            await app.close();
        });

        it('returns 400 when platform is missing or not ios/android', async () => {
            const app = buildPushApp();

            const res = await app.inject({
                method: 'POST',
                url: '/push/register',
                payload: { token: 'tok-X', platform: 'symbian' },
            });

            expect(res.statusCode).toBe(400);
            expect(res.json()).toMatchObject({ error: 'bad-request' });
            await app.close();
        });

        it('returns 404 when the push handler is absent', async () => {
            const app = buildApp({ getStatus: () => buildStatus() });

            const res = await app.inject({
                method: 'POST',
                url: '/push/register',
                payload: { token: 'tok-A', platform: 'ios' },
            });

            expect(res.statusCode).toBe(404);
            await app.close();
        });
    });

    describe('POST /push/unregister', () => {
        it('returns 200 with status "unregistered" and forwards the token', async () => {
            const calls: string[] = [];
            const app = buildPushApp({ unregister: async (token) => { calls.push(token); } });

            const res = await app.inject({
                method: 'POST',
                url: '/push/unregister',
                payload: { token: 'tok-B' },
            });

            expect(res.statusCode).toBe(200);
            expect(res.json()).toEqual({ status: 'unregistered' });
            expect(calls).toEqual(['tok-B']);
            await app.close();
        });

        it('returns 200 even when the handler is given an unknown token (idempotent)', async () => {
            const app = buildPushApp({ unregister: async () => {} });

            const res = await app.inject({
                method: 'POST',
                url: '/push/unregister',
                payload: { token: 'tok-missing' },
            });

            expect(res.statusCode).toBe(200);
            await app.close();
        });

        it('returns 400 when token is missing', async () => {
            const app = buildPushApp();

            const res = await app.inject({
                method: 'POST',
                url: '/push/unregister',
                payload: {},
            });

            expect(res.statusCode).toBe(400);
            await app.close();
        });

        it('returns 404 when the push handler is absent', async () => {
            const app = buildApp({ getStatus: () => buildStatus() });

            const res = await app.inject({
                method: 'POST',
                url: '/push/unregister',
                payload: { token: 'tok-A' },
            });

            expect(res.statusCode).toBe(404);
            await app.close();
        });
    });
});

describe('buildApp /system routes', () => {
    const SINCE_ISO = '2026-05-21T12:34:56.000Z';
    const buildEnabled = () => ({ irrigationEnabled: true, since: SINCE_ISO });
    const buildDisabled = () => ({ irrigationEnabled: false, since: SINCE_ISO });

    describe('GET /system', () => {
        it('returns 200 with the DTO from the handler', async () => {
            const app = buildApp({
                getStatus: () => buildStatus(),
                system: {
                    get: async () => buildEnabled(),
                    enable: async () => buildEnabled(),
                    disable: async () => buildDisabled(),
                },
            });

            const res = await app.inject({ method: 'GET', url: '/system' });

            expect(res.statusCode).toBe(200);
            expect(res.json()).toEqual({ irrigationEnabled: true, since: SINCE_ISO });
            await app.close();
        });

        it('returns 404 when system handler is absent from BuildAppOptions', async () => {
            const app = buildApp({ getStatus: () => buildStatus() });

            const res = await app.inject({ method: 'GET', url: '/system' });

            expect(res.statusCode).toBe(404);
            await app.close();
        });
    });

    describe('POST /system/enable', () => {
        it('returns 200 with the post-flip DTO', async () => {
            const app = buildApp({
                getStatus: () => buildStatus(),
                system: {
                    get: async () => buildDisabled(),
                    enable: async () => buildEnabled(),
                    disable: async () => buildDisabled(),
                },
            });

            const res = await app.inject({ method: 'POST', url: '/system/enable' });

            expect(res.statusCode).toBe(200);
            expect(res.json()).toEqual({ irrigationEnabled: true, since: SINCE_ISO });
            await app.close();
        });

        it('returns 502 with error: replan-failed when the wrapped handler rejects', async () => {
            const base: SystemApi = {
                get: async () => buildDisabled(),
                enable: async () => buildEnabled(),
                disable: async () => buildDisabled(),
            };
            const wrapped = wrapSystemWithReplan(base, async () => { throw new Error('HA 503'); });
            const app = buildApp({ getStatus: () => buildStatus(), system: wrapped });

            const res = await app.inject({ method: 'POST', url: '/system/enable' });

            expect(res.statusCode).toBe(502);
            expect(res.json()).toMatchObject({ error: 'replan-failed', message: 'HA 503' });
            await app.close();
        });
    });

    describe('POST /system/disable', () => {
        it('returns 200 with the post-flip DTO', async () => {
            const app = buildApp({
                getStatus: () => buildStatus(),
                system: {
                    get: async () => buildEnabled(),
                    enable: async () => buildEnabled(),
                    disable: async () => buildDisabled(),
                },
            });

            const res = await app.inject({ method: 'POST', url: '/system/disable' });

            expect(res.statusCode).toBe(200);
            expect(res.json()).toEqual({ irrigationEnabled: false, since: SINCE_ISO });
            await app.close();
        });

        it('returns 502 with error: replan-failed when the wrapped handler rejects', async () => {
            const base: SystemApi = {
                get: async () => buildEnabled(),
                enable: async () => buildEnabled(),
                disable: async () => buildDisabled(),
            };
            const wrapped = wrapSystemWithReplan(base, async () => { throw new Error('HA 504'); });
            const app = buildApp({ getStatus: () => buildStatus(), system: wrapped });

            const res = await app.inject({ method: 'POST', url: '/system/disable' });

            expect(res.statusCode).toBe(502);
            expect(res.json()).toMatchObject({ error: 'replan-failed', message: 'HA 504' });
            await app.close();
        });
    });
});

describe('wrapSystemWithReplan', () => {
    const buildState = (enabled: boolean) => ({ irrigationEnabled: enabled, since: '2026-05-21T12:00:00.000Z' });

    it('calls replan after enable, awaiting it before returning', async () => {
        const callOrder: string[] = [];
        const base: SystemApi = {
            get: async () => buildState(false),
            enable: async () => { callOrder.push('enable'); return buildState(true); },
            disable: async () => buildState(false),
        };
        const wrapped = wrapSystemWithReplan(base, async () => {
            await Promise.resolve();
            callOrder.push('replan');
        });

        const result = await wrapped.enable();
        callOrder.push('returned');

        expect(result.irrigationEnabled).toBe(true);
        expect(callOrder).toEqual(['enable', 'replan', 'returned']);
    });

    it('calls replan after disable', async () => {
        const callOrder: string[] = [];
        const base: SystemApi = {
            get: async () => buildState(true),
            enable: async () => buildState(true),
            disable: async () => { callOrder.push('disable'); return buildState(false); },
        };
        const wrapped = wrapSystemWithReplan(base, async () => { callOrder.push('replan'); });

        await wrapped.disable();

        expect(callOrder).toEqual(['disable', 'replan']);
    });

    it('does NOT call replan on get (reads are side-effect-free)', async () => {
        let replanCalls = 0;
        const base: SystemApi = {
            get: async () => buildState(true),
            enable: async () => buildState(true),
            disable: async () => buildState(false),
        };
        const wrapped = wrapSystemWithReplan(base, async () => { replanCalls += 1; });

        await wrapped.get();

        expect(replanCalls).toBe(0);
    });

    it('propagates replan rejections so the route can map them to 502', async () => {
        const base: SystemApi = {
            get: async () => buildState(true),
            enable: async () => buildState(true),
            disable: async () => buildState(false),
        };
        const wrapped = wrapSystemWithReplan(base, async () => { throw new Error('replan failed'); });

        await expect(wrapped.enable()).rejects.toThrow('replan failed');
    });
});

describe('buildApp GET /activity', () => {
    function buildDto(overrides?: Partial<ActivityDto>): ActivityDto {
        return {
            id: 'entry-1',
            date: '2026-05-20',
            zone: { id: 'zone-1', name: 'Front Lawn', slug: 'front-lawn' },
            appliedDepthMm: 8.4,
            durationMin: 42,
            depletionBeforeMm: 12.0,
            depletionAfterMm: 0.3,
            source: 'planner',
            ...overrides,
        };
    }

    type RecordedCall = ActivityListParams;

    function recordingActivity(result: ActivityListResult): {
        handler: (params: ActivityListParams) => Promise<ActivityListResult>;
        calls: RecordedCall[];
    } {
        const calls: RecordedCall[] = [];
        return {
            handler: async (params) => {
                calls.push(params);
                return result;
            },
            calls,
        };
    }

    it('returns 200 with the lister result', async () => {
        const result: ActivityListResult = {
            activity: [buildDto(), buildDto({ id: 'entry-2', source: 'manual' })],
            nextCursor: encodeCursor('2026-05-19', 'entry-cursor'),
        };
        const { handler } = recordingActivity(result);
        const app = buildApp({ getStatus: () => buildStatus(), activity: handler });

        const res = await app.inject({ method: 'GET', url: '/activity' });

        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual(result);
        await app.close();
    });

    it('returns 404 when the activity handler is absent', async () => {
        const app = buildApp({ getStatus: () => buildStatus() });

        const res = await app.inject({ method: 'GET', url: '/activity' });

        expect(res.statusCode).toBe(404);
        await app.close();
    });

    it('defaults limit to 20 when no limit query param is provided', async () => {
        const { handler, calls } = recordingActivity({ activity: [], nextCursor: null });
        const app = buildApp({ getStatus: () => buildStatus(), activity: handler });

        await app.inject({ method: 'GET', url: '/activity' });

        expect(calls).toHaveLength(1);
        expect(calls[0]?.limit).toBe(20);
        expect(calls[0]?.zoneId).toBeUndefined();
        expect(calls[0]?.cursor).toBeUndefined();
        await app.close();
    });

    it('passes the zoneId query param through to the handler', async () => {
        const { handler, calls } = recordingActivity({ activity: [], nextCursor: null });
        const app = buildApp({ getStatus: () => buildStatus(), activity: handler });

        await app.inject({ method: 'GET', url: '/activity?zoneId=zone-001' });

        expect(calls[0]?.zoneId).toBe('zone-001');
        await app.close();
    });

    it('passes a parsed numeric limit through to the handler', async () => {
        const { handler, calls } = recordingActivity({ activity: [], nextCursor: null });
        const app = buildApp({ getStatus: () => buildStatus(), activity: handler });

        await app.inject({ method: 'GET', url: '/activity?limit=5' });

        expect(calls[0]?.limit).toBe(5);
        await app.close();
    });

    it('passes the cursor through verbatim when it round-trips', async () => {
        const cursor = encodeCursor('2026-05-19', 'entry-prev');
        const { handler, calls } = recordingActivity({ activity: [], nextCursor: null });
        const app = buildApp({ getStatus: () => buildStatus(), activity: handler });

        await app.inject({ method: 'GET', url: `/activity?cursor=${encodeURIComponent(cursor)}` });

        expect(calls[0]?.cursor).toBe(cursor);
        await app.close();
    });

    it('returns 400 when limit is not an integer', async () => {
        const { handler } = recordingActivity({ activity: [], nextCursor: null });
        const app = buildApp({ getStatus: () => buildStatus(), activity: handler });

        const res = await app.inject({ method: 'GET', url: '/activity?limit=abc' });

        expect(res.statusCode).toBe(400);
        expect(res.json()).toMatchObject({ error: 'bad-request' });
        await app.close();
    });

    it('returns 400 when limit is zero or negative', async () => {
        const { handler } = recordingActivity({ activity: [], nextCursor: null });
        const app = buildApp({ getStatus: () => buildStatus(), activity: handler });

        const zero = await app.inject({ method: 'GET', url: '/activity?limit=0' });
        const negative = await app.inject({ method: 'GET', url: '/activity?limit=-3' });

        expect(zero.statusCode).toBe(400);
        expect(negative.statusCode).toBe(400);
        await app.close();
    });

    it('returns 400 when limit exceeds the max', async () => {
        const { handler } = recordingActivity({ activity: [], nextCursor: null });
        const app = buildApp({ getStatus: () => buildStatus(), activity: handler });

        const res = await app.inject({ method: 'GET', url: '/activity?limit=999' });

        expect(res.statusCode).toBe(400);
        await app.close();
    });

    it('returns 400 when cursor is malformed', async () => {
        const { handler } = recordingActivity({ activity: [], nextCursor: null });
        const app = buildApp({ getStatus: () => buildStatus(), activity: handler });

        const res = await app.inject({ method: 'GET', url: '/activity?cursor=not-a-cursor' });

        expect(res.statusCode).toBe(400);
        expect(res.json()).toMatchObject({ error: 'bad-request' });
        await app.close();
    });
});

describe('buildApp GET /tonight', () => {
    const SCHEDULED_PAYLOAD: TonightDto = {
        state: 'scheduled',
        startTime: '2026-05-21T03:00:00.000Z',
        endsAt: '2026-05-21T03:30:00.000Z',
        axisStart: '20:30',
        axisEnd: '05:30',
        sunset: '20:30',
        sunrise: '05:30',
        zoneOrder: ['North'],
        totalCycles: 1,
        zones: [{ name: 'North', slug: 'north', patch: 'a', cycles: [{ start: '03:00', durMin: 30 }] }],
    };

    it('returns 200 with the handler payload verbatim', async () => {
        const app = buildApp({
            getStatus: () => buildStatus(),
            tonight: async () => SCHEDULED_PAYLOAD,
        });

        const res = await app.inject({ method: 'GET', url: '/tonight' });

        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual(SCHEDULED_PAYLOAD);
        await app.close();
    });

    it('returns 404 when the tonight handler is absent', async () => {
        const app = buildApp({ getStatus: () => buildStatus() });

        const res = await app.inject({ method: 'GET', url: '/tonight' });

        expect(res.statusCode).toBe(404);
        await app.close();
    });

    it('re-evaluates the handler on each request (not memoized)', async () => {
        let callCount = 0;
        const app = buildApp({
            getStatus: () => buildStatus(),
            tonight: async () => {
                callCount += 1;
                return { ...SCHEDULED_PAYLOAD, totalCycles: callCount };
            },
        });

        await app.inject({ method: 'GET', url: '/tonight' });
        const second = await app.inject({ method: 'GET', url: '/tonight' });

        expect(second.json()).toMatchObject({ totalCycles: 2 });
        expect(callCount).toBe(2);
        await app.close();
    });

    it('serializes idle/skipped payloads with null time fields', async () => {
        const idle: TonightDto = {
            state: 'idle',
            startTime: null,
            endsAt: null,
            axisStart: null,
            axisEnd: null,
            sunset: null,
            sunrise: null,
            zoneOrder: [],
            totalCycles: 0,
            zones: [],
        };
        const app = buildApp({ getStatus: () => buildStatus(), tonight: async () => idle });

        const res = await app.inject({ method: 'GET', url: '/tonight' });

        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual(idle);
        await app.close();
    });
});

describe('buildApp GET /schedules', () => {
    const SAMPLE_LIST: ScheduleListItem[] = [
        {
            id: 'sched-active',
            slug: 'maintenance',
            name: 'Maintenance',
            isActive: true,
            allowedDays: [3, 5, 7],
            allowedTimeWindows: [{ start: '00:00', end: '10:00' }],
            rootDepthMOverride: null,
            allowableDepletionFractionOverride: null,
            endBySunrise: true,
            nextRun: { inLabel: 'in 5 hours', whenLabel: 'Tomorrow at 3:00 AM', zonesLabel: 'North, South' },
            skippedTonight: false,
        },
        {
            id: 'sched-inactive',
            slug: 'overseeding',
            name: 'Overseeding',
            isActive: false,
            allowedDays: null,
            allowedTimeWindows: null,
            rootDepthMOverride: 0.45,
            allowableDepletionFractionOverride: 0.35,
            endBySunrise: null,
        },
    ];

    it('returns 200 with the handler payload verbatim', async () => {
        const app = buildApp({
            getStatus: () => buildStatus(),
            schedulesList: async () => SAMPLE_LIST,
        });

        const res = await app.inject({ method: 'GET', url: '/schedules' });

        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual(SAMPLE_LIST);
        await app.close();
    });

    it('returns 404 when the schedulesList handler is absent', async () => {
        const app = buildApp({ getStatus: () => buildStatus() });

        const res = await app.inject({ method: 'GET', url: '/schedules' });

        expect(res.statusCode).toBe(404);
        await app.close();
    });

    it('re-evaluates the handler on each request (not memoized)', async () => {
        let callCount = 0;
        const app = buildApp({
            getStatus: () => buildStatus(),
            schedulesList: async () => {
                callCount += 1;
                return SAMPLE_LIST.slice(0, callCount);
            },
        });

        const first = await app.inject({ method: 'GET', url: '/schedules' });
        const second = await app.inject({ method: 'GET', url: '/schedules' });

        expect(first.json()).toHaveLength(1);
        expect(second.json()).toHaveLength(2);
        expect(callCount).toBe(2);
        await app.close();
    });

    it('returns an empty array when the handler returns []', async () => {
        const app = buildApp({ getStatus: () => buildStatus(), schedulesList: async () => [] });

        const res = await app.inject({ method: 'GET', url: '/schedules' });

        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual([]);
        await app.close();
    });
});

describe('readExpoAccessToken', () => {
    it('returns undefined when EXPO_ACCESS_TOKEN is unset', () => {
        expect(readExpoAccessToken({})).toBeUndefined();
    });

    it('returns undefined when EXPO_ACCESS_TOKEN is an empty string', () => {
        expect(readExpoAccessToken({ EXPO_ACCESS_TOKEN: '' })).toBeUndefined();
    });

    it('returns the token verbatim when EXPO_ACCESS_TOKEN is set to a non-empty string', () => {
        expect(readExpoAccessToken({ EXPO_ACCESS_TOKEN: 'expo-token-abc123' })).toBe('expo-token-abc123');
    });
});
