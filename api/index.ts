import Config from '@/config';
import {
    acknowledgeAlert,
    createAlerter,
    listActiveAlerts,
    type AckResult,
    type AlertDto,
    type AlertsDb,
} from '@/alerts';
import { start as daemonStart, type DaemonControl, type DaemonDb, type DaemonStatus } from '@/daemon';
import { realClock } from '@/daemon/runtime';
import {
    disableSchedule as defaultDisableSchedule,
    enableSchedule as defaultEnableSchedule,
    resumeActiveScheduleTonight as defaultResumeActiveScheduleTonight,
    skipActiveScheduleTonight as defaultSkipActiveScheduleTonight,
    type Schedule,
    type ScheduleManagerDb,
} from '@/daemon/schedule-manager';
import dayjs from 'dayjs';
import { loadZoneById, loadZoneSummaries, type ZoneSummary, type ZoneSummaryDb } from '@/daemon/zones';
import { closeZone, getZoneState, openZone } from '@/data/home-assistant';
import { queryLatestMigrationViaDrizzle, readJournalFile, verifyMigrations } from '@/db/verify-migrations';
import { BusyError, createManualController, type ManualController } from '@/manual';
import type { Zone } from '@/models';
import { createNotifier } from '@/notifications';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const shutdownStarted = new WeakSet<FastifyInstance>();

/**
 * Build-time options for the Fastify app. `manual` and `zoneById` are
 * optional so tests that only care about `/` and `/health` don't have to
 * stub the manual surface.
 */
/**
 * Subset of the `ScheduleManager` API exposed to HTTP. Both methods return
 * the post-update `Schedule` row, or `null` if the slug is unknown so the
 * route handler can map that to a 404.
 */
export type ScheduleApi = {
    enable: (slug: string) => Promise<Schedule | null>;
    disable: (slug: string) => Promise<Schedule | null>;
    skipTonight: () => Promise<Schedule | null>;
    resumeTonight: () => Promise<Schedule | null>;
};

/**
 * Wraps a base `ScheduleApi` so that any non-null `enable` / `disable`
 * result triggers `replan` before resolving. The wrapper keeps the route
 * handler synchronous-looking: when the route awaits `schedule.enable`,
 * it implicitly awaits the re-plan too. When the base call returns null
 * (unknown slug), the re-plan is skipped — there's nothing to re-plan
 * against. Errors from `replan` propagate to the route, which maps them
 * to a 502 response.
 *
 * @param base - The underlying schedule manager (DB-backed in production).
 * @param replan - The daemon's `rePlan` reference.
 * @returns A new `ScheduleApi` that drives a re-plan after each successful
 *   activation change.
 */
export function wrapScheduleWithReplan(base: ScheduleApi, replan: () => Promise<void>): ScheduleApi {
    return {
        enable: async slug => {
            const result = await base.enable(slug);
            if (result !== null) await replan();
            return result;
        },
        disable: async slug => {
            const result = await base.disable(slug);
            if (result !== null) await replan();
            return result;
        },
        skipTonight: async () => {
            const result = await base.skipTonight();
            if (result !== null) await replan();
            return result;
        },
        resumeTonight: async () => {
            const result = await base.resumeTonight();
            if (result !== null) await replan();
            return result;
        },
    };
}

export type BuildAppOptions = {
    getStatus: () => DaemonStatus;
    manual?: ManualController;
    zoneById?: (zoneId: string) => Promise<Zone | null>;
    schedule?: ScheduleApi;

    /**
     * Optional. When supplied, registers `POST /replan` that calls this
     * function. The route returns the post-re-plan daemon status so
     * operators can confirm `lastRePlanAt` advanced. Production wires
     * `daemon.rePlan` here.
     */
    replan?: () => Promise<void>;

    /**
     * Optional. When supplied, registers `GET /zones` which returns the
     * mobile-app zone summary list. The loader fans out to two read queries
     * (zones × grass × soil, and the latest schedule-entry per zone) so
     * production callers should pass the Drizzle `db`. Routes that don't
     * need this surface can omit the field.
     */
    zonesSummary?: () => Promise<ZoneSummary[]>;

    /**
     * Optional. When supplied, registers `GET /alerts` and `POST /alerts/:id/ack`
     * — the persistent alert region surface for the mobile app. Production
     * binds these to the alerts module's DB-backed reader and ack helper.
     */
    alerts?: {
        list: () => Promise<AlertDto[]>;
        ack: (id: string) => Promise<AckResult>;
    };
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

    if (opts.schedule) {
        registerScheduleRoutes(app, opts.schedule);
    }

    if (opts.replan) {
        registerReplanRoute(app, opts.replan, opts.getStatus);
    }

    if (opts.zonesSummary) {
        registerZonesSummaryRoute(app, opts.zonesSummary);
    }

    if (opts.alerts) {
        registerAlertRoutes(app, opts.alerts);
    }

    return app;
}

function registerAlertRoutes(
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

function registerZonesSummaryRoute(
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

function registerReplanRoute(app: FastifyInstance, replan: () => Promise<void>, getStatus: () => DaemonStatus): void {
    /**
     * `POST /replan` — forces the daemon to re-plan immediately. Used by the
     * CLI scripts to make schedule changes take effect within seconds rather
     * than at the next 04:00 site-local tick. Returns 200 with the post-
     * re-plan `lastRePlanAt`; 502 if the re-plan itself rejects.
     */
    app.post('/replan', async (_req, reply) => {
        try {
            await replan();
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return reply.code(502).send({ error: 'replan-failed', message });
        }
        const status = getStatus();
        return reply.code(200).send({ status: 'replanned', lastRePlanAt: status.lastRePlanAt });
    });
}

function registerScheduleRoutes(app: FastifyInstance, schedule: ScheduleApi): void {
    /**
     * `POST /schedule/enable/:slug` — atomically activates the named schedule
     * and deactivates any other schedule that's currently active on the same
     * site. 200 with the schedule on success; 404 when the slug is unknown.
     */
    app.post('/schedule/enable/:slug', async (req, reply) => {
        const { slug } = req.params as { slug: string };
        let result;
        try {
            result = await schedule.enable(slug);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return reply.code(502).send({ error: 'replan-failed', message });
        }
        if (result === null) {
            return reply.code(404).send({ error: 'not-found', message: `Schedule '${slug}' not found.` });
        }
        return reply.code(200).send({
            status: 'enabled',
            schedule: { slug: result.slug, name: result.name, siteId: result.siteId },
        });
    });

    /**
     * `POST /schedule/disable/:slug` — deactivates the named schedule.
     * Idempotent at the data layer (already-inactive returns success). 404
     * when the slug is unknown.
     */
    app.post('/schedule/disable/:slug', async (req, reply) => {
        const { slug } = req.params as { slug: string };
        let result;
        try {
            result = await schedule.disable(slug);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return reply.code(502).send({ error: 'replan-failed', message });
        }
        if (result === null) {
            return reply.code(404).send({ error: 'not-found', message: `Schedule '${slug}' not found.` });
        }
        return reply.code(200).send({
            status: 'disabled',
            schedule: { slug: result.slug, name: result.name, siteId: result.siteId },
        });
    });

    /**
     * `POST /schedule/skip-tonight` — sets a one-night skip marker on the active
     * schedule so the planner drops tonight's cycles. 404 if no schedule is
     * currently active; 502 if the wrapped re-plan rejects.
     */
    app.post('/schedule/skip-tonight', async (_req, reply) => {
        let result;
        try {
            result = await schedule.skipTonight();
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return reply.code(502).send({ error: 'replan-failed', message });
        }
        if (result === null) {
            return reply.code(404).send({ error: 'not-found', message: 'No active schedule.' });
        }
        return reply.code(200).send({
            status: 'skipped',
            schedule: {
                slug: result.slug,
                name: result.name,
                siteId: result.siteId,
                skippedNightDate: result.skippedNightDate,
            },
        });
    });

    /**
     * `POST /schedule/resume-tonight` — clears the skip marker on the active
     * schedule. Idempotent (already-cleared returns success). 404 if no
     * schedule is active; 502 if the wrapped re-plan rejects.
     */
    app.post('/schedule/resume-tonight', async (_req, reply) => {
        let result;
        try {
            result = await schedule.resumeTonight();
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return reply.code(502).send({ error: 'replan-failed', message });
        }
        if (result === null) {
            return reply.code(404).send({ error: 'not-found', message: 'No active schedule.' });
        }
        return reply.code(200).send({
            status: 'resumed',
            schedule: {
                slug: result.slug,
                name: result.name,
                siteId: result.siteId,
                skippedNightDate: result.skippedNightDate,
            },
        });
    });
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

    const verification = await verifyMigrations({
        queryLatestMigration: () => queryLatestMigrationViaDrizzle(query => db.execute(query)),
        readJournal: () => readJournalFile(path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'drizzle')),
    });
    if (!verification.ok) {
        console.error(`startup: ${verification.message}`);
        process.exit(1);
    }
    console.log('startup: database schema verified.');

    const notifier = createNotifier();
    const dryRun = process.env.DRY_RUN === 'true';
    if (dryRun) {
        console.log(
            'startup: DRY_RUN=true — HA relay calls are disabled; cycles will be planned and logged but sprinklers will not activate.',
        );
    } else {
        console.log('startup: DRY_RUN=false - HA relay calls are enabled');
    }

    const openMeteoEnabled = process.env.OPEN_METEO_ENABLED !== 'false';
    if (openMeteoEnabled) {
        console.log('startup: OPEN_METEO_ENABLED=true - Open-Meteo weather integration is enabled');
    } else {
        console.log('startup: OPEN_METEO_ENABLED=false — Open-Meteo weather integration is disabled; the planner will not be able to fetch forecasts.');
    }
    const effectiveOpenZone: typeof openZone =
        dryRun ?
            async zone => {
                console.log(`dry-run: would open zone ${zone.id} (${zone.name}).`);
            }
        :   openZone;
    const effectiveCloseZone: typeof closeZone =
        dryRun ?
            async zone => {
                console.log(`dry-run: would close zone ${zone.id} (${zone.name}).`);
            }
        :   closeZone;
    const effectiveGetZoneState: typeof getZoneState = dryRun ? async _zone => 'off' as const : getZoneState;
    const alertsDb = db as unknown as AlertsDb;
    const alerter = createAlerter(alertsDb, notifier);
    const daemon = await daemonStart(db as unknown as DaemonDb, {
        notifier,
        alerter,
        openZone: effectiveOpenZone,
        closeZone: effectiveCloseZone,
        getZoneState: effectiveGetZoneState,
    });
    const manual = createManualController({
        db: db as unknown as Parameters<typeof createManualController>[0]['db'],
        clock: realClock,
        openZone: effectiveOpenZone,
        closeZone: effectiveCloseZone,
        notifier,
        isAnyScheduledInFlight: () => daemon.getStatus().activeZones.length > 0,
    });
    const scheduleDb = db as unknown as ScheduleManagerDb;
    const baseSchedule: ScheduleApi = {
        enable: slug => defaultEnableSchedule(scheduleDb, slug),
        disable: slug => defaultDisableSchedule(scheduleDb, slug),
        skipTonight: () => defaultSkipActiveScheduleTonight(scheduleDb, dayjs(realClock.now()).format('YYYY-MM-DD')),
        resumeTonight: () => defaultResumeActiveScheduleTonight(scheduleDb),
    };
    const app = buildApp({
        getStatus: daemon.getStatus,
        manual,
        zoneById: zoneId => loadZoneById(db as unknown as Parameters<typeof loadZoneById>[0], zoneId),
        schedule: wrapScheduleWithReplan(baseSchedule, () => daemon.rePlan()),
        replan: () => daemon.rePlan(),
        zonesSummary: () => loadZoneSummaries(db as unknown as ZoneSummaryDb),
        alerts: {
            list: () => listActiveAlerts(alertsDb),
            ack: id => acknowledgeAlert(alertsDb, id),
        },
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
