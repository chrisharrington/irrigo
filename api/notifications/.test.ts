import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test';
import { createNotifier, noopNotifier, buildMessage } from '.';

const mockFetch = mock(() => Promise.resolve({} as Response));
(global as unknown as { fetch: typeof mockFetch }).fetch = mockFetch;

const HA_URL = 'http://ha.local:8123';
const HA_TOKEN = 'test-token-456';
const HA_NOTIFY_SERVICE = 'mobile_app_pixel_8';

const ENV_KEYS = [
    'HA_URL',
    'HA_TOKEN',
    'HA_NOTIFY_SERVICE',
    'NOTIFY_ON_WATERING_START',
    'NOTIFY_ON_WATERING_END',
    'NOTIFY_ON_ERROR',
] as const;

describe('createNotifier', () => {
    let saved: Record<string, string | undefined>;
    let warnSpy: ReturnType<typeof spyOn>;

    beforeEach(() => {
        saved = {};
        for (const key of ENV_KEYS) saved[key] = process.env[key];
        process.env.HA_URL = HA_URL;
        process.env.HA_TOKEN = HA_TOKEN;
        process.env.HA_NOTIFY_SERVICE = HA_NOTIFY_SERVICE;
        delete process.env.NOTIFY_ON_WATERING_START;
        delete process.env.NOTIFY_ON_WATERING_END;
        delete process.env.NOTIFY_ON_ERROR;
        mockFetch.mockClear();
        mockFetch.mockResolvedValue({ ok: true, status: 200, statusText: 'OK' } as Response);
        warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        for (const key of ENV_KEYS) {
            if (saved[key] === undefined) delete process.env[key];
            else process.env[key] = saved[key];
        }
        warnSpy.mockRestore();
    });

    it('returns the no-op notifier and warns when HA_NOTIFY_SERVICE is unset', async () => {
        delete process.env.HA_NOTIFY_SERVICE;

        const notifier = createNotifier();

        expect(notifier).toBe(noopNotifier);
        await notifier('error', { zoneName: 'Front Lawn', operation: 'open', reason: 'oops' });
        expect(mockFetch).not.toHaveBeenCalled();
        expect(warnSpy).toHaveBeenCalledTimes(1);
    });

    it('returns the no-op notifier when HA_URL is missing', () => {
        delete process.env.HA_URL;

        const notifier = createNotifier();

        expect(notifier).toBe(noopNotifier);
    });

    it('returns the no-op notifier when HA_TOKEN is missing', () => {
        delete process.env.HA_TOKEN;

        const notifier = createNotifier();

        expect(notifier).toBe(noopNotifier);
    });

    it('does not POST a watering-started event by default (opt-in)', async () => {
        const notifier = createNotifier();

        await notifier('watering-started', { zoneName: 'Front Lawn', durationMin: 20 });

        expect(mockFetch).not.toHaveBeenCalled();
    });

    it('does not POST a watering-ended event by default (opt-in)', async () => {
        const notifier = createNotifier();

        await notifier('watering-ended', { zoneName: 'Front Lawn' });

        expect(mockFetch).not.toHaveBeenCalled();
    });

    it('POSTs an error event by default (errors should be loud)', async () => {
        const notifier = createNotifier();

        await notifier('error', { zoneName: 'Front Lawn', operation: 'open', reason: 'HA down' });

        expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('POSTs a watering-started event when NOTIFY_ON_WATERING_START=true', async () => {
        process.env.NOTIFY_ON_WATERING_START = 'true';
        const notifier = createNotifier();

        await notifier('watering-started', { zoneName: 'Front Lawn', durationMin: 20 });

        expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('POSTs to the HA notify service URL with bearer auth and JSON body shape', async () => {
        process.env.NOTIFY_ON_WATERING_START = 'true';
        const notifier = createNotifier();

        await notifier('watering-started', { zoneName: 'Front Lawn', durationMin: 20 });

        const [calledUrl, init] = mockFetch.mock.calls[0] as [string, RequestInit];
        expect(calledUrl).toBe(`${HA_URL}/api/services/notify/${HA_NOTIFY_SERVICE}`);
        expect(init.method).toBe('POST');
        const headers = init.headers as Record<string, string>;
        expect(headers['Authorization']).toBe(`Bearer ${HA_TOKEN}`);
        expect(headers['Content-Type']).toBe('application/json');
        const parsed = JSON.parse(init.body as string) as { message: string; title: string };
        expect(parsed.title).toBe('Irrigo');
        expect(parsed.message).toContain('Front Lawn');
        expect(parsed.message).toContain('20');
    });

    it('builds different messages for boot-armed and natural watering-started events', async () => {
        process.env.NOTIFY_ON_WATERING_START = 'true';
        const notifier = createNotifier();

        await notifier('watering-started', { zoneName: 'Front Lawn', durationMin: 20 });
        await notifier('watering-started', { zoneName: 'Front Lawn', durationMin: 20, reason: 'boot' });

        const calls = mockFetch.mock.calls as Array<[string, RequestInit]>;
        const firstMessage = (JSON.parse(calls[0]![1].body as string) as { message: string }).message;
        const secondMessage = (JSON.parse(calls[1]![1].body as string) as { message: string }).message;
        expect(firstMessage).not.toContain('daemon restart');
        expect(secondMessage).toContain('daemon restart');
    });

    it('builds a shutdown-qualified message for shutdown-driven watering-ended events', async () => {
        process.env.NOTIFY_ON_WATERING_END = 'true';
        const notifier = createNotifier();

        await notifier('watering-ended', { zoneName: 'Front Lawn', reason: 'shutdown' });

        const init = mockFetch.mock.calls[0]![1] as RequestInit;
        const message = (JSON.parse(init.body as string) as { message: string }).message;
        expect(message).toContain('shutdown');
    });

    it('includes operation and reason in error event messages', async () => {
        const notifier = createNotifier();

        await notifier('error', { zoneName: 'Front Lawn', operation: 'open', reason: 'HA 502' });

        const init = mockFetch.mock.calls[0]![1] as RequestInit;
        const message = (JSON.parse(init.body as string) as { message: string }).message;
        expect(message).toContain('open');
        expect(message).toContain('HA 502');
        expect(message).toContain('Front Lawn');
    });

    it('swallows fetch rejections without throwing and logs a warning', async () => {
        mockFetch.mockRejectedValueOnce(new Error('network down'));
        const notifier = createNotifier();

        await expect(notifier('error', { operation: 'open', reason: 'oops' })).resolves.toBeUndefined();
        expect(warnSpy).toHaveBeenCalled();
    });

    it('swallows non-2xx responses without throwing and logs a warning', async () => {
        mockFetch.mockResolvedValueOnce({ ok: false, status: 502, statusText: 'Bad Gateway' } as Response);
        const notifier = createNotifier();

        await expect(notifier('error', { operation: 'open', reason: 'oops' })).resolves.toBeUndefined();
        expect(warnSpy).toHaveBeenCalled();
    });

    it('treats NOTIFY_ON_ERROR=false as disabled', async () => {
        process.env.NOTIFY_ON_ERROR = 'false';
        const notifier = createNotifier();

        await notifier('error', { operation: 'open', reason: 'oops' });

        expect(mockFetch).not.toHaveBeenCalled();
    });

    it('parses 1/0 as truthy/falsy for the flags', async () => {
        process.env.NOTIFY_ON_WATERING_START = '1';
        process.env.NOTIFY_ON_WATERING_END = '0';
        const notifier = createNotifier();

        await notifier('watering-started', { zoneName: 'A' });
        await notifier('watering-ended', { zoneName: 'A' });

        expect(mockFetch).toHaveBeenCalledTimes(1);
    });
});

describe('buildMessage', () => {
    it('includes zone name and duration for watering-started', () => {
        const msg = buildMessage('watering-started', { zoneName: 'Front Lawn', durationMin: 20 });
        expect(msg).toContain('Front Lawn');
        expect(msg).toContain('20');
        expect(msg).toContain('watering started');
    });

    it('omits duration for watering-started when not provided', () => {
        const msg = buildMessage('watering-started', { zoneName: 'Front Lawn' });
        expect(msg).toContain('Front Lawn');
        expect(msg).not.toContain('min');
    });

    it('appends boot-recovery qualifier for watering-started with reason=boot', () => {
        const msg = buildMessage('watering-started', { zoneName: 'Front Lawn', durationMin: 10, reason: 'boot' });
        expect(msg).toContain('daemon restart');
    });

    it('returns a simple ended message for watering-ended', () => {
        const msg = buildMessage('watering-ended', { zoneName: 'Back Garden' });
        expect(msg).toContain('Back Garden');
        expect(msg).toContain('watering ended');
        expect(msg).not.toContain('shutdown');
    });

    it('appends shutdown qualifier for watering-ended with reason=shutdown', () => {
        const msg = buildMessage('watering-ended', { zoneName: 'Back Garden', reason: 'shutdown' });
        expect(msg).toContain('shutdown');
    });

    it('includes operation and reason for error events', () => {
        const msg = buildMessage('error', { zoneName: 'Front Lawn', operation: 'open', reason: 'HA 502' });
        expect(msg).toContain('Front Lawn');
        expect(msg).toContain('open');
        expect(msg).toContain('HA 502');
    });

    it('falls back to Zone when zoneName is omitted', () => {
        const msg = buildMessage('watering-started', {});
        expect(msg).toContain('Zone');
    });
});
