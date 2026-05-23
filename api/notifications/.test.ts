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
    'NOTIFY_ON_SCHEDULE_START',
    'NOTIFY_ON_SCHEDULE_END',
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
        delete process.env.NOTIFY_ON_SCHEDULE_START;
        delete process.env.NOTIFY_ON_SCHEDULE_END;
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
        await notifier('error', { zoneName: 'Front Lawn', errorTitle: 'Manual open failed', errorSub: 'Last attempt failed: oops.' });
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

    it('POSTs a schedule-begun event by default (opt-out)', async () => {
        const notifier = createNotifier();

        await notifier('schedule-begun', { scheduleNight: '2026-05-15' });

        expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('POSTs a schedule-ended event by default (opt-out)', async () => {
        const notifier = createNotifier();

        await notifier('schedule-ended', {
            scheduleNight: '2026-05-15',
            perZoneRuntimeMin: { North: 47 },
            siteTimezone: 'America/Edmonton',
        });

        expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('does not POST schedule events when their flag is set to false', async () => {
        process.env.NOTIFY_ON_SCHEDULE_START = 'false';
        process.env.NOTIFY_ON_SCHEDULE_END = 'false';
        const notifier = createNotifier();

        await notifier('schedule-begun', { scheduleNight: '2026-05-15' });
        await notifier('schedule-ended', { scheduleNight: '2026-05-15' });

        expect(mockFetch).not.toHaveBeenCalled();
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

        await notifier('error', { zoneName: 'Front Lawn', errorTitle: 'HA open failed', errorSub: 'Last attempt failed: HA down.' });

        expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('POSTs a watering-started event when NOTIFY_ON_WATERING_START=true', async () => {
        process.env.NOTIFY_ON_WATERING_START = 'true';
        const notifier = createNotifier();

        await notifier('watering-started', { zoneName: 'Front Lawn', durationMin: 20 });

        expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('POSTs to the HA notify service URL with bearer auth and JSON body shape', async () => {
        const notifier = createNotifier();

        await notifier('schedule-begun', { scheduleNight: '2026-05-15' });

        const [calledUrl, init] = mockFetch.mock.calls[0] as [string, RequestInit];
        expect(calledUrl).toBe(`${HA_URL}/api/services/notify/${HA_NOTIFY_SERVICE}`);
        expect(init.method).toBe('POST');
        const headers = init.headers as Record<string, string>;
        expect(headers['Authorization']).toBe(`Bearer ${HA_TOKEN}`);
        expect(headers['Content-Type']).toBe('application/json');
        const parsed = JSON.parse(init.body as string) as { message: string; title: string };
        expect(parsed.title).toBe('Irrigo');
        expect(parsed.message).toContain('2026-05-15');
    });

    it('swallows fetch rejections without throwing and logs a warning', async () => {
        mockFetch.mockRejectedValueOnce(new Error('network down'));
        const notifier = createNotifier();

        await expect(notifier('error', { errorTitle: 'HA open failed', errorSub: 'Last attempt failed: oops.' })).resolves.toBeUndefined();
        expect(warnSpy).toHaveBeenCalled();
    });

    it('swallows non-2xx responses without throwing and logs a warning', async () => {
        mockFetch.mockResolvedValueOnce({ ok: false, status: 502, statusText: 'Bad Gateway' } as Response);
        const notifier = createNotifier();

        await expect(notifier('error', { errorTitle: 'HA open failed', errorSub: 'Last attempt failed: oops.' })).resolves.toBeUndefined();
        expect(warnSpy).toHaveBeenCalled();
    });

    it('treats NOTIFY_ON_ERROR=false as disabled', async () => {
        process.env.NOTIFY_ON_ERROR = 'false';
        const notifier = createNotifier();

        await notifier('error', { errorTitle: 'HA open failed', errorSub: 'Last attempt failed: oops.' });

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

// Golden-string assertions. These pin the exact operator-facing copy for every
// `(event, context)` combination so the next time someone touches a builder,
// the diff is intentional (it forces the test author to update the literal).
//
// API-63 added these after a push leaked `weather-stale on South: Planner on
// fallback ET₀ ·` to a phone. The asserts below cover that scenario and every
// other branch in `buildMessage` end-to-end.
describe('buildMessage — golden output', () => {
    it('schedule-begun (with night) — exact string.', () => {
        expect(buildMessage('schedule-begun', { scheduleNight: '2026-05-15' }))
            .toBe('Irrigation schedule started for the night of 2026-05-15.');
    });

    it('schedule-begun (no context) — generic fallback.', () => {
        expect(buildMessage('schedule-begun'))
            .toBe('Irrigation schedule started.');
    });

    it('schedule-ended (per-zone summary + next, fixed timezone) — exact string.', () => {
        const msg = buildMessage('schedule-ended', {
            scheduleNight: '2026-05-15',
            perZoneRuntimeMin: { South: 32, North: 47, East: 28 },
            siteTimezone: 'America/Edmonton',
            // 2026-05-23T04:23Z = 22:23 MDT on 2026-05-22 (Friday).
            nextIrrigation: { zoneName: 'North', startTime: new Date('2026-05-23T04:23:00.000Z') },
        });
        expect(msg).toBe('Irrigation complete: East 28 min, North 47 min, South 32 min. Next irrigation: North on Fri 22 May at 10:23pm.');
    });

    it('schedule-ended (no summary, no next) — generic complete message.', () => {
        expect(buildMessage('schedule-ended', { scheduleNight: '2026-05-15' }))
            .toBe('Irrigation complete.');
    });

    it('schedule-ended rounds fractional minutes to one decimal.', () => {
        expect(buildMessage('schedule-ended', {
            scheduleNight: '2026-05-15',
            perZoneRuntimeMin: { North: 47.36 },
            siteTimezone: 'America/Edmonton',
        })).toBe('Irrigation complete: North 47.4 min.');
    });

    it('watering-started (auto-fire, with duration) — exact string.', () => {
        expect(buildMessage('watering-started', { zoneName: 'Front Lawn', durationMin: 20 }))
            .toBe('Front Lawn watering started (~20 min).');
    });

    it('watering-started (manual fire, with duration) — exact string.', () => {
        expect(buildMessage('watering-started', { zoneName: 'Front Lawn', durationMin: 20, reason: 'manual' }))
            .toBe('Front Lawn watering started (~20 min) (manual fire).');
    });

    it('watering-started (no duration, missing zone name) — falls back to Zone.', () => {
        expect(buildMessage('watering-started', {}))
            .toBe('Zone watering started.');
    });

    it('watering-ended (default) — exact string.', () => {
        expect(buildMessage('watering-ended', { zoneName: 'Back Garden' }))
            .toBe('Back Garden watering ended.');
    });

    it('watering-ended (shutdown) — exact string.', () => {
        expect(buildMessage('watering-ended', { zoneName: 'Back Garden', reason: 'shutdown' }))
            .toBe('Back Garden watering ended (closed during daemon shutdown).');
    });

    it('watering-ended (manual) — exact string.', () => {
        expect(buildMessage('watering-ended', { zoneName: 'Back Garden', reason: 'manual' }))
            .toBe('Back Garden watering ended (manual fire).');
    });

    it('error (zone + title + sub — the original bug scenario, now ASCII and slug-free).', () => {
        const msg = buildMessage('error', {
            zoneName: 'South',
            errorTitle: 'Weather API stale',
            errorSub: 'Planner using fallback ET zero. Last fetch error: 502 Bad Gateway.',
        });
        expect(msg).toBe('South: Weather API stale. Planner using fallback ET zero. Last fetch error: 502 Bad Gateway.');
        // Guardrails: the slug, the subscript, and the middot must never leak.
        expect(msg).not.toContain('weather-stale');
        expect(msg).not.toContain('·');
        expect(msg).not.toContain('₀');
    });

    it('error (zone + title, no sub) — exact string.', () => {
        expect(buildMessage('error', { zoneName: 'North', errorTitle: 'HA close failed' }))
            .toBe('North: HA close failed.');
    });

    it('error (title only, no zone, no sub) — exact string.', () => {
        expect(buildMessage('error', { errorTitle: 'Weather API stale' }))
            .toBe('Weather API stale.');
    });

    it('error (no context at all) — generic fallback.', () => {
        expect(buildMessage('error'))
            .toBe('Irrigo error.');
    });
});
