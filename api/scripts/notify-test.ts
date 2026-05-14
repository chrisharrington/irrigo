import { buildMessage } from '@/notifications';

const TEST_NIGHT = '2026-05-15';
const TEST_SITE_TIMEZONE = 'America/Edmonton';
const TEST_PER_ZONE_RUNTIME_MIN = { North: 47, South: 32, East: 28 };
const TEST_NEXT_IRRIGATION = {
    zoneName: 'North',
    startTime: new Date('2026-05-23T04:23:00.000Z'),
};

export type NotifyTestSendResult = { ok: boolean; status: number; statusText: string };

export type NotifyTestDeps = {
    send: (message: string) => Promise<NotifyTestSendResult>;
    log: (message: string) => void;
    error: (message: string) => void;
};

export async function notifyTestCli(deps: NotifyTestDeps): Promise<0 | 1> {
    let exitCode: 0 | 1 = 0;

    const begunMsg = buildMessage('schedule-begun', { scheduleNight: TEST_NIGHT });
    deps.log(`notify-test: sending schedule-begun → "${begunMsg}"`);
    const begunResult = await deps.send(begunMsg);
    if (!begunResult.ok) {
        deps.error(`notify-test: schedule-begun returned ${begunResult.status} ${begunResult.statusText}`);
        exitCode = 1;
    }

    const endedMsg = buildMessage('schedule-ended', {
        scheduleNight: TEST_NIGHT,
        perZoneRuntimeMin: TEST_PER_ZONE_RUNTIME_MIN,
        siteTimezone: TEST_SITE_TIMEZONE,
        nextIrrigation: TEST_NEXT_IRRIGATION,
    });
    deps.log(`notify-test: sending schedule-ended → "${endedMsg}"`);
    const endedResult = await deps.send(endedMsg);
    if (!endedResult.ok) {
        deps.error(`notify-test: schedule-ended returned ${endedResult.status} ${endedResult.statusText}`);
        exitCode = 1;
    }

    return exitCode;
}

if (import.meta.main) {
    const url = process.env.HA_URL;
    const token = process.env.HA_TOKEN;
    const service = process.env.HA_NOTIFY_SERVICE;

    if (!url || !token || !service) {
        console.error('notify-test: HA_URL, HA_TOKEN, and HA_NOTIFY_SERVICE must all be set in the environment.');
        process.exit(1);
    }

    const endpoint = `${url.endsWith('/') ? url.slice(0, -1) : url}/api/services/notify/${service}`;

    const deps: NotifyTestDeps = {
        send: async (message) => {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ message, title: 'Irrigo' }),
            });
            return { ok: response.ok, status: response.status, statusText: response.statusText };
        },
        log: m => console.log(m),
        error: m => console.error(m),
    };

    notifyTestCli(deps).then(code => process.exit(code));
}
