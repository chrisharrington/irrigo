import type { FastifyInstance } from 'fastify';
import type { PushRegistration } from '@/models/push-token';

export function registerPushRoutes(
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
