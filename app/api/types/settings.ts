/**
 * Wire-format of the notification toggles returned by
 * `GET /settings/notifications` and `PATCH /settings/notifications`. Each flag
 * gates one push-notification event class; all five are required booleans on
 * the GET/response shape. Server-side defaults: schedule start/end + error on,
 * watering start/end off.
 */
export type NotificationSettingsDto = {
    scheduleStart: boolean;
    scheduleEnd: boolean;
    wateringStart: boolean;
    wateringEnd: boolean;
    error: boolean;
};

/**
 * Body accepted by `PATCH /settings/notifications` — any subset of the flags.
 * The route echoes back the full updated {@link NotificationSettingsDto}.
 */
export type NotificationSettingsPatch = Partial<NotificationSettingsDto>;
