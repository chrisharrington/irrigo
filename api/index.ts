import Config from '@/config';
import { listActivity, type ActivityDb } from '@/activity';
import {
    acknowledgeAlert,
    createAlerter,
    listActiveAlerts,
    type AlertsDb,
} from '@/alerts';
import {
    bootDaemonService,
    start as daemonStart,
    type DaemonControl,
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
import { closeZone, getZoneState, openZone } from '@/data/home-assistant';
import { bootSystemService, getSystemState, setIrrigationEnabled } from '@/service/system';
import { bootNotificationSettingsService, getNotificationSettings, updateNotificationSettings } from '@/service/notification-settings';
import type { Database } from '@/db';
import {
    bootPushTokensService,
    dispatchAlertPush,
    registerPushToken,
    sendCategoryPush,
    unregisterPushToken,
} from '@/service/push-tokens';
import Expo from 'expo-server-sdk';
import { bootTonightService, getTonightSummary } from '@/service/tonight';
import { bootSchedulesListService, listSchedules } from '@/service/schedules-list';
import { queryLatestMigrationViaDrizzle, readJournalFile, verifyMigrations } from '@/db/verify-migrations';
import {
    bootManualService,
    createManualController,
    type ManualController,
} from '@/service/manual';
import type { FastifyInstance } from 'fastify';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildApp } from '@/build-app';
import { wrapScheduleWithReplan, type ScheduleApi } from '@/routes/schedule';
import { wrapSystemWithReplan, type SystemApi } from '@/routes/system';

// Transitional re-exports: `api/.test.ts` imports these from `@/index`. API-91
// step 4 moves that suite next to its new subjects and drops these.
export { buildApp } from '@/build-app';
export type { BuildAppOptions } from '@/build-app';
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
