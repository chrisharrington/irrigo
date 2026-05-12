import { describe, it, expect } from 'bun:test';
import { notifyTestCli, type NotifyTestDeps, type NotifyTestSendResult } from './notify-test';
import { buildMessage } from '@/notifications';

const ok: NotifyTestSendResult = { ok: true, status: 200, statusText: 'OK' };
const fail: NotifyTestSendResult = { ok: false, status: 502, statusText: 'Bad Gateway' };

function recordingDeps(overrides: Partial<NotifyTestDeps>): {
    deps: NotifyTestDeps;
    sends: string[];
    logs: string[];
    errors: string[];
} {
    const sends: string[] = [];
    const logs: string[] = [];
    const errors: string[] = [];
    const deps: NotifyTestDeps = {
        send: async (msg) => { sends.push(msg); return ok; },
        log: m => logs.push(m),
        error: m => errors.push(m),
        ...overrides,
    };
    return { deps, sends, logs, errors };
}

describe('notifyTestCli', () => {
    it('sends watering-started then watering-ended in order', async () => {
        const { deps, sends } = recordingDeps({});

        await notifyTestCli(deps);

        expect(sends).toHaveLength(2);
        expect(sends[0]).toBe(buildMessage('watering-started', { zoneName: 'Front Lawn', durationMin: 15 }));
        expect(sends[1]).toBe(buildMessage('watering-ended', { zoneName: 'Front Lawn' }));
    });

    it('returns 0 when both sends succeed', async () => {
        const { deps } = recordingDeps({});

        const code = await notifyTestCli(deps);

        expect(code).toBe(0);
    });

    it('logs each message before sending', async () => {
        const { deps, logs } = recordingDeps({});

        await notifyTestCli(deps);

        expect(logs).toHaveLength(2);
        expect(logs[0]).toContain('watering-started');
        expect(logs[1]).toContain('watering-ended');
    });

    it('returns 1 and logs an error when the first send fails', async () => {
        let callCount = 0;
        const { deps, errors } = recordingDeps({
            send: async () => callCount++ === 0 ? fail : ok,
        });

        const code = await notifyTestCli(deps);

        expect(code).toBe(1);
        expect(errors).toHaveLength(1);
        expect(errors[0]).toContain('watering-started');
        expect(errors[0]).toContain('502');
    });

    it('returns 1 and logs an error when the second send fails', async () => {
        let callCount = 0;
        const { deps, errors } = recordingDeps({
            send: async () => callCount++ === 0 ? ok : fail,
        });

        const code = await notifyTestCli(deps);

        expect(code).toBe(1);
        expect(errors).toHaveLength(1);
        expect(errors[0]).toContain('watering-ended');
        expect(errors[0]).toContain('502');
    });

    it('sends both notifications even when the first fails', async () => {
        let callCount = 0;
        const { deps, sends } = recordingDeps({
            send: async (msg) => { sends.push(msg); return callCount++ === 0 ? fail : ok; },
        });

        await notifyTestCli(deps);

        expect(sends).toHaveLength(2);
    });
});
