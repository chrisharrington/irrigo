import Fastify, { type FastifyInstance } from 'fastify';
import type { ActivityListParams, ActivityListResult } from '@/activity';
import type { AckResult, AlertDto } from '@/alerts';
import type { DaemonStatus } from '@/service/daemon';
import type { ManualController } from '@/service/manual';
import type { Zone } from '@/models';
import type { ZoneSummary } from '@/models/zone';
import type { TonightDto } from '@/models/tonight';
import type { ScheduleListItem } from '@/service/schedules-list';
import type { PushRegistration } from '@/models/push-token';

import { registerManualRoutes } from '@/routes/manual';
import { registerScheduleRoutes, type ScheduleApi } from '@/routes/schedule';
import { registerSystemRoutes, type SystemApi } from '@/routes/system';
import { registerNotificationSettingsRoutes, type NotificationSettingsApi } from '@/routes/notification-settings';
import { registerReplanRoute } from '@/routes/replan';
import { registerZonesSummaryRoute } from '@/routes/zones-summary';
import { registerAlertRoutes } from '@/routes/alerts';
import { registerActivityRoute } from '@/routes/activity';
import { registerTonightRoute } from '@/routes/tonight';
import { registerSchedulesListRoute } from '@/routes/schedules-list';
import { registerPushRoutes } from '@/routes/push';

/**
 * Build-time options for the Fastify app. `manual` and `zoneById` are
 * optional so tests that only care about `/` and `/health` don't have to
 * stub the manual surface.
 */
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
