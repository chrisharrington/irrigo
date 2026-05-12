import { buildMessage } from '@/notifications';

const TEST_ZONE = 'Front Lawn';
const TEST_DURATION_MIN = 15;

export type NotifyTestSendResult = { ok: boolean; status: number; statusText: string };

export type NotifyTestDeps = {
    send: (message: string) => Promise<NotifyTestSendResult>;
    log: (message: string) => void;
    error: (message: string) => void;
};

export async function notifyTestCli(deps: NotifyTestDeps): Promise<0 | 1> {
    let exitCode: 0 | 1 = 0;

    const startedMsg = buildMessage('watering-started', { zoneName: TEST_ZONE, durationMin: TEST_DURATION_MIN });
    deps.log(`notify-test: sending watering-started → "${startedMsg}"`);
    const startedResult = await deps.send(startedMsg);
    if (!startedResult.ok) {
        deps.error(`notify-test: watering-started returned ${startedResult.status} ${startedResult.statusText}`);
        exitCode = 1;
    }

    const endedMsg = buildMessage('watering-ended', { zoneName: TEST_ZONE });
    deps.log(`notify-test: sending watering-ended → "${endedMsg}"`);
    const endedResult = await deps.send(endedMsg);
    if (!endedResult.ok) {
        deps.error(`notify-test: watering-ended returned ${endedResult.status} ${endedResult.statusText}`);
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
