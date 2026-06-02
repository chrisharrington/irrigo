/**
 * Wire-format snapshot of the operator's per-event notification toggles.
 * Served by `GET /settings/notifications` and echoed by `PATCH`; also read
 * live by `createNotifier` to decide whether to fire each event.
 *
 * All five fields are required booleans. `scheduleStart` / `scheduleEnd`
 * cover the daemon's scheduled runs; `wateringStart` / `wateringEnd` cover
 * manual operator fires; `error` covers failure notifications.
 */
export type NotificationSettingsDto = {
    scheduleStart: boolean;
    scheduleEnd: boolean;
    wateringStart: boolean;
    wateringEnd: boolean;
    error: boolean;
};

/**
 * Partial update accepted by `PATCH /settings/notifications` — any subset of
 * the five flags. Keys outside the DTO are rejected by the route with a 400.
 */
export type NotificationSettingsPatch = Partial<NotificationSettingsDto>;

/**
 * Default toggles, matching the historical `NOTIFY_ON_*` env defaults so first
 * boot (and the defensive fallback when the singleton row is missing) preserve
 * today's behaviour.
 */
export const NOTIFICATION_SETTINGS_DEFAULTS: NotificationSettingsDto = {
    scheduleStart: true,
    scheduleEnd: true,
    wateringStart: false,
    wateringEnd: false,
    error: true,
};
