import Config from '@/config';
import {
    DEFAULT_ACTIVITY_LIMIT,
    listActivity,
    MAX_ACTIVITY_LIMIT,
    type ActivityDb,
    type ActivityListParams,
    type ActivityListResult,
} from '@/activity';
import { decodeCursor } from '@/util/cursor';
import {
    acknowledgeAlert,
    createAlerter,
    listActiveAlerts,
    type AckResult,
    type AlertDto,
    type AlertsDb,
} from '@/alerts';
import {
    bootDaemonService,
    start as daemonStart,
    type DaemonControl,
    type DaemonStatus,
} from '@/service/daemon';
import { realClock } from '@/service/daemon/runtime';
import {
    bootSchedulesService,
    disableSchedule as defaultDisableSchedule,
    enableSchedule as defaultEnableSchedule,
    resumeActiveScheduleTonight as defaultResumeActiveScheduleTonight,
    skipActiveScheduleTonight as defaultSkipActiveScheduleTonight,
} from '@/service/schedules';
import { bootSitesService } from '@/service/sites';
import { bootZonesService, getZoneById, getZoneSummaries } from '@/service/zones';
import dayjs from 'dayjs';
import type { ZoneSummary } from '@/models/zone';
import { closeZone, getZoneState, openZone } from '@/data/home-assistant';
import { bootSystemService, getSystemState, setIrrigationEnabled } from '@/service/system';
import { bootNotificationSettingsService, getNotificationSettings, updateNotificationSettings } from '@/service/notification-settings';
import type { Database } from '@/db';
import type { PushRegistration } from '@/models/push-token';
import type { TonightDto } from '@/models/tonight';
import {
    bootPushTokensService,
    dispatchAlertPush,
    registerPushToken,
    sendCategoryPush,
    unregisterPushToken,
} from '@/service/push-tokens';
import Expo from 'expo-server-sdk';
import { bootTonightService, getTonightSummary } from '@/service/tonight';
import {
    bootSchedulesListService,
    listSchedules,
    type ScheduleListItem,
} from '@/service/schedules-list';
import { queryLatestMigrationViaDrizzle, readJournalFile, verifyMigrations } from '@/db/verify-migrations';
import {
    bootManualService,
    createManualController,
    type ManualController,
} from '@/service/manual';
import type { Zone } from '@/models';
import Fastify, { type FastifyInstance } from 'fastify';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { registerManualRoutes } from '@/routes/manual';
import { registerScheduleRoutes, wrapScheduleWithReplan, type ScheduleApi } from '@/routes/schedule';
import { registerSystemRoutes, wrapSystemWithReplan, type SystemApi } from '@/routes/system';
import { registerNotificationSettingsRoutes, type NotificationSettingsApi } from '@/routes/notification-settings';
import { registerReplanRoute } from '@/routes/replan';
import { registerZonesSummaryRoute } from '@/routes/zones-summary';

// Transitional re-exports: `api/.test.ts` imports these from `@/index`. API-91
// step 4 moves that suite next to its new subjects and drops these.
export { wrapScheduleWithReplan, wrapSystemWithReplan };
export type { ScheduleApi, SystemApi };

const shutdownStarted = new WeakSet<FastifyInstance>();

/**
 * Reads `EXPO_ACCESS_TOKEN` from the given environment object. Returns the
 * token verbatim when present and non-empty; returns `undefined` when unset
 * or empty so the caller can fall back to an unauthenticated `new Expo()`.
 * Pulled out as a pure helper so the conditional is unit-testable without
 * mutating `process.env`.
 */
export function readExpoAccessToken(env: NodeJS.ProcessEnv): string | undefined {
    const value = env['EXPO_ACCESS_TOKEN'];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
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

    /**
     * Optional. When supplied, registers `GET /system`, `POST /system/enable`
     * and `POST /system/disable` — the master irrigation kill switch surface.
     * Production wraps the base handlers with `wrapSystemWithReplan` so each
     * flip triggers an immediate re-plan.
     */
    system?: SystemApi;

    /**
     * Optional. When supplied, registers `GET /settings/notifications` and
     * `PATCH /settings/notifications` — the operator notification toggles
     * surface backing the mobile settings screen. Production binds these to
     * the notification-settings service.
     */
    notificationSettings?: NotificationSettingsApi;

    /**
     * Optional. When supplied, registers `GET /tonight` — the next-run
     * summary backing the mobile Home hero card and `CycleStrip`. Production
     * binds this to the tonight module's DB-backed lister.
     */
    tonight?: () => Promise<TonightDto>;

    /**
     * Optional. When supplied, registers `GET /schedules` — the list payload
     * for the Schedules screen, drawer footer, and Home active-schedule chip.
     * The active row in the list is enriched with `nextRun` labels and a
     * `skippedTonight` flag. Production wires this to the schedules-list
     * module.
     */
    schedulesList?: () => Promise<ScheduleListItem[]>;

    /**
     * Optional. When supplied, registers `GET /activity` — the chronological
     * schedule-entries feed driving the Activity screen and the "Recent runs"
     * section on Zone detail. Production wires this to the activity module's
     * DB-backed lister.
     */
    activity?: (params: ActivityListParams) => Promise<ActivityListResult>;

    /**
     * Optional. When supplied, registers `POST /push/register` and
     * `POST /push/unregister` — Expo Push token registration for the mobile
     * app's push notifications. Production wires these to the push-tokens
     * service.
     */
    push?: {
        register: (input: PushRegistration) => Promise<void>;
        unregister: (token: string) => Promise<void>;
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
     * Accept bodyless / empty-body POSTs regardless of `Content-Type`. Most of
     * Irrigo's mutating routes are RPC-style — the path carries all the intent
     * and the body is empty (zone open/close, alert ack, system enable/disable,
     * schedule toggles, replan). React Native's Android networking attaches an
     * empty `Content-Type` header to such requests, which bare Fastify rejects
     * with `415 Unsupported Media Type: undefined` before the handler runs. A
     * catch-all parser that tolerates an absent body makes these succeed from a
     * real device; routes that take a real JSON body (e.g. `/push/register`)
     * are unaffected — the built-in `application/json` parser still wins for
     * `application/json` requests, and this only fires when no parser matches.
     */
    app.addContentTypeParser('*', { parseAs: 'string' }, (_req, body, done) => {
        done(null, body.length > 0 ? body : undefined);
    });

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

    if (opts.system) {
        registerSystemRoutes(app, opts.system);
    }

    if (opts.notificationSettings) {
        registerNotificationSettingsRoutes(app, opts.notificationSettings);
    }

    if (opts.activity) {
        registerActivityRoute(app, opts.activity);
    }

    if (opts.tonight) {
        registerTonightRoute(app, opts.tonight);
    }

    if (opts.schedulesList) {
        registerSchedulesListRoute(app, opts.schedulesList);
    }

    if (opts.push) {
        registerPushRoutes(app, opts.push);
    }

    return app;
}

function registerPushRoutes(
    app: FastifyInstance,
    push: {
        register: (input: PushRegistration) => Promise<void>;
        unregister: (token: string) => Promise<void>;
    },
): void {
    /**
     * `POST /push/register` — registers (or refreshes) a device's Expo Push
     * token. Idempotent: re-registering the same token refreshes the row's
     * `platform`, `user_agent`, and `updated_at`. Returns 400 on missing /
     * invalid body, 200 with `{ status: 'registered' }` on success.
     */
    app.post('/push/register', async (req, reply) => {
        const body = req.body as Record<string, unknown> | undefined;
        const tokenRaw = body?.['token'];
        const platformRaw = body?.['platform'];
        const userAgentRaw = body?.['userAgent'];

        if (typeof tokenRaw !== 'string' || tokenRaw.length === 0) {
            return reply.code(400).send({ error: 'bad-request', message: 'token must be a non-empty string.' });
        }
        if (platformRaw !== 'ios' && platformRaw !== 'android') {
            return reply.code(400).send({ error: 'bad-request', message: `platform must be 'ios' or 'android'.` });
        }
        const userAgent =
            typeof userAgentRaw === 'string' && userAgentRaw.length > 0 ? userAgentRaw : null;

        await push.register({ token: tokenRaw, platform: platformRaw, userAgent });
        return reply.code(200).send({ status: 'registered' });
    });

    /**
     * `POST /push/unregister` — removes a device's Expo Push token. Idempotent:
     * 200 even when the token was never registered.
     */
    app.post('/push/unregister', async (req, reply) => {
        const body = req.body as Record<string, unknown> | undefined;
        const tokenRaw = body?.['token'];
        if (typeof tokenRaw !== 'string' || tokenRaw.length === 0) {
            return reply.code(400).send({ error: 'bad-request', message: 'token must be a non-empty string.' });
        }

        await push.unregister(tokenRaw);
        return reply.code(200).send({ status: 'unregistered' });
    });
}

function registerTonightRoute(app: FastifyInstance, tonight: () => Promise<TonightDto>): void {
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

function registerSchedulesListRoute(
    app: FastifyInstance,
    schedulesList: () => Promise<ScheduleListItem[]>,
): void {
    /**
     * `GET /schedules` — list of every schedule (active + inactive) for the
     * mobile app's Schedules screen, drawer footer, and Home active-schedule
     * chip. The active row carries `nextRun` and `skippedTonight`; inactive
     * rows omit both fields.
     */
    app.get('/schedules', async (_req, reply) => {
        const result = await schedulesList();
        return reply.code(200).send(result);
    });
}

function registerActivityRoute(
    app: FastifyInstance,
    activity: (params: ActivityListParams) => Promise<ActivityListResult>,
): void {
    /**
     * `GET /activity` — chronological schedule-entries feed. Drives the
     * Activity screen (no filter) and Zone detail's "Recent runs" tab
     * (?zoneId=…). Pagination is keyset: pass `?cursor=` from the previous
     * response to fetch the next page.
     */
    app.get('/activity', async (req, reply) => {
        const query = req.query as Record<string, unknown>;
        const zoneIdRaw = query['zoneId'];
        const zoneId = typeof zoneIdRaw === 'string' && zoneIdRaw.length > 0 ? zoneIdRaw : undefined;

        const limitRaw = query['limit'];
        let limit = DEFAULT_ACTIVITY_LIMIT;
        if (limitRaw !== undefined) {
            const parsed = typeof limitRaw === 'string' ? Number(limitRaw) : Number(limitRaw);
            if (!Number.isInteger(parsed) || parsed <= 0 || parsed > MAX_ACTIVITY_LIMIT) {
                return reply.code(400).send({
                    error: 'bad-request',
                    message: `limit must be an integer between 1 and ${MAX_ACTIVITY_LIMIT}.`,
                });
            }
            limit = parsed;
        }

        const cursorRaw = query['cursor'];
        let cursor: string | undefined;
        if (cursorRaw !== undefined) {
            if (typeof cursorRaw !== 'string' || cursorRaw.length === 0 || decodeCursor(cursorRaw) === null) {
                return reply.code(400).send({ error: 'bad-request', message: 'cursor is malformed.' });
            }
            cursor = cursorRaw;
        }

        const result = await activity({
            ...(zoneId !== undefined ? { zoneId } : {}),
            limit,
            ...(cursor !== undefined ? { cursor } : {}),
        });
        return reply.code(200).send(result);
    });
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

    const expoAccessToken = readExpoAccessToken(process.env);
    if (expoAccessToken) {
        console.log('startup: EXPO_ACCESS_TOKEN is set; Expo push API calls will include the bearer token.');
    } else {
        console.log('startup: EXPO_ACCESS_TOKEN is unset; Expo push API calls will be unauthenticated (publicly callable — anyone with a leaked push token can target users).');
    }
    const expo = expoAccessToken ? new Expo({ accessToken: expoAccessToken }) : new Expo();
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
    const typedDb = db as unknown as Database;
    bootSystemService({ db: typedDb });
    bootNotificationSettingsService({ db: typedDb });
    bootSitesService({ db: typedDb });
    bootSchedulesService({ db: typedDb });
    bootZonesService({ db: typedDb });
    bootManualService({ db: typedDb });
    bootSchedulesListService({ db: typedDb });
    bootTonightService({ db: typedDb });
    bootPushTokensService({ db: typedDb, expo });
    bootDaemonService({ db: typedDb });
    const alerter = createAlerter(alertsDb, dispatchAlertPush);
    const daemon = await daemonStart({
        pushNotify: sendCategoryPush,
        alerter,
        openZone: effectiveOpenZone,
        closeZone: effectiveCloseZone,
        getZoneState: effectiveGetZoneState,
    });
    const manual = createManualController({
        clock: realClock,
        openZone: effectiveOpenZone,
        closeZone: effectiveCloseZone,
        pushNotify: sendCategoryPush,
        isAnyScheduledInFlight: () => daemon.getStatus().activeZones.length > 0,
        isIrrigationEnabled: async () => (await getSystemState()).irrigationEnabled,
    });
    const baseSchedule: ScheduleApi = {
        enable: slug => defaultEnableSchedule(slug),
        disable: slug => defaultDisableSchedule(slug),
        skipTonight: () => defaultSkipActiveScheduleTonight(dayjs(realClock.now())),
        resumeTonight: () => defaultResumeActiveScheduleTonight(),
    };
    const baseSystem: SystemApi = {
        get: () => getSystemState(),
        enable: () => setIrrigationEnabled(true, realClock.now()),
        disable: () => setIrrigationEnabled(false, realClock.now()),
    };
    const app = buildApp({
        getStatus: daemon.getStatus,
        manual,
        zoneById: zoneId => getZoneById(zoneId),
        schedule: wrapScheduleWithReplan(baseSchedule, () => daemon.rePlan()),
        replan: () => daemon.rePlan(),
        zonesSummary: () => getZoneSummaries(manual.getActiveZone()),
        alerts: {
            list: () => listActiveAlerts(alertsDb),
            ack: id => acknowledgeAlert(alertsDb, id),
        },
        system: wrapSystemWithReplan(baseSystem, () => daemon.rePlan()),
        notificationSettings: {
            get: () => getNotificationSettings(),
            update: patch => updateNotificationSettings(patch),
        },
        activity: params => listActivity(db as unknown as ActivityDb, params),
        tonight: () => getTonightSummary(realClock.now()),
        schedulesList: () => listSchedules(realClock.now()),
        push: {
            register: input => registerPushToken(input),
            unregister: token => unregisterPushToken(token),
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
