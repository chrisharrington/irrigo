import type { FastifyInstance } from 'fastify';
import type { NotificationSettingsDto, NotificationSettingsPatch } from '@/models/notification-settings';

/**
 * HTTP surface of the operator notification toggles. Production wires this
 * against `getNotificationSettings` / `updateNotificationSettings` from
 * `@/service/notification-settings`.
 */
export type NotificationSettingsApi = {
    get: () => Promise<NotificationSettingsDto>;
    update: (patch: NotificationSettingsPatch) => Promise<NotificationSettingsDto>;
};

const NOTIFICATION_SETTINGS_KEYS = ['scheduleStart', 'scheduleEnd', 'wateringStart', 'wateringEnd', 'error'] as const;

export function registerNotificationSettingsRoutes(app: FastifyInstance, settings: NotificationSettingsApi): void {
    /**
     * `GET /settings/notifications` — the operator's five per-event toggles,
     * backing the mobile settings screen. Always 200 with the full DTO.
     */
    app.get('/settings/notifications', async (_req, reply) => {
        const dto = await settings.get();
        return reply.code(200).send(dto);
    });

    /**
     * `PATCH /settings/notifications` — updates any subset of the five flags
     * and echoes the full updated DTO. The body must be an object whose keys
     * are all recognised flags and whose values are all booleans; any unknown
     * key or non-boolean value is a 400. An empty body is a valid no-op that
     * returns the current settings.
     */
    app.patch('/settings/notifications', async (req, reply) => {
        const body = req.body;
        if (typeof body !== 'object' || body === null || Array.isArray(body)) {
            return reply.code(400).send({ error: 'bad-request', message: 'Body must be a JSON object.' });
        }

        const patch: NotificationSettingsPatch = {};
        for (const [key, value] of Object.entries(body)) {
            if (!(NOTIFICATION_SETTINGS_KEYS as readonly string[]).includes(key)) {
                return reply.code(400).send({ error: 'bad-request', message: `Unknown field '${key}'.` });
            }
            if (typeof value !== 'boolean') {
                return reply.code(400).send({ error: 'bad-request', message: `Field '${key}' must be a boolean.` });
            }
            patch[key as keyof NotificationSettingsPatch] = value;
        }

        const dto = await settings.update(patch);
        return reply.code(200).send(dto);
    });
}
