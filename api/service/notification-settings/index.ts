import type { Database } from '@/db';
import {
    createNotificationSettingsRepository,
    type NotificationSettingsRepository,
} from '@/repositories/notification-settings';
import {
    NOTIFICATION_SETTINGS_DEFAULTS,
    type NotificationSettingsDto,
    type NotificationSettingsPatch,
} from '@/models/notification-settings';

/**
 * Input to `bootNotificationSettingsService`. Production passes `{ db }` — the
 * service builds its own repository via the factory. Tests pass `{ repo }`
 * with a fake implementation; no Drizzle stub needed.
 */
export type BootNotificationSettingsServiceInput =
    | { db: Database }
    | { repo: NotificationSettingsRepository };

let repo: NotificationSettingsRepository | null = null;

/**
 * Wires the notification-settings service to its repository. Call once at
 * process boot; call again in test `beforeEach` with a fake repository to
 * isolate behavior. Service functions throw with a clear message if invoked
 * before this is called.
 */
export function bootNotificationSettingsService(input: BootNotificationSettingsServiceInput): void {
    repo = 'repo' in input ? input.repo : createNotificationSettingsRepository(input.db);
}

function getRepo(): NotificationSettingsRepository {
    if (!repo) {
        throw new Error('Notification-settings service not booted — call bootNotificationSettingsService({ db }) at startup.');
    }
    return repo;
}

/**
 * Reads the notification toggles. If the singleton row is missing (a bypassed
 * migration), warns and returns the defaults so the notifier and routes keep
 * working — operators can tell something is off from the log line. Mirrors
 * `getSystemState`'s defensive fallback.
 */
export async function getNotificationSettings(): Promise<NotificationSettingsDto> {
    const row = await getRepo().findSingleton();
    if (!row) {
        console.warn('notification-settings: singleton row missing — falling back to defaults. Re-run migrations.');
        return { ...NOTIFICATION_SETTINGS_DEFAULTS };
    }
    return row;
}

/**
 * Merges `patch` onto the current settings (or the defaults when the row is
 * missing), persists the full row, and returns the post-update DTO so routes
 * can echo it back without a re-read.
 *
 * @param patch - Any subset of the five flags.
 */
export async function updateNotificationSettings(patch: NotificationSettingsPatch): Promise<NotificationSettingsDto> {
    const current = await getNotificationSettings();
    const next: NotificationSettingsDto = { ...current, ...patch };
    await getRepo().upsertSingleton(next);
    console.log(`notification-settings: updated ${JSON.stringify(patch)}.`);
    return next;
}
