import type { FastifyInstance } from 'fastify';
import {
    DEFAULT_ACTIVITY_LIMIT,
    MAX_ACTIVITY_LIMIT,
    type ActivityListParams,
    type ActivityListResult,
} from '@/activity';
import { decodeCursor } from '@/util/cursor';

export function registerActivityRoute(
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
