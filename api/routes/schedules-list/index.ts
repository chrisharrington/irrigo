import type { FastifyInstance } from 'fastify';
import type { ScheduleListItem } from '@/service/schedules-list';

export function registerSchedulesListRoute(
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
