import {
    ackAlert,
    closeZone,
    disableSchedule,
    disableSystem,
    enableSchedule,
    enableSystem,
    getActivity,
    getAlerts,
    getSchedules,
    getSystem,
    getTonight,
    getZones,
    openZone,
    registerPushToken,
    replan,
    resumeScheduleTonight,
    runZone,
    skipScheduleTonight,
    unregisterPushToken,
} from '.';

const mockFetch = jest.fn();

beforeEach(() => {
    (global as { fetch: typeof fetch }).fetch = mockFetch as unknown as typeof fetch;
    mockFetch.mockReset();
    process.env.EXPO_PUBLIC_API_BASE_URL = 'http://test.local:9753';
});

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
    });
}

function lastCall(): { url: string; init: RequestInit } {
    const [url, init] = mockFetch.mock.calls.at(-1) as [string, RequestInit];
    return { url, init };
}

describe('system endpoints', () => {
    it('GETs /system and returns the DTO unchanged.', async () => {
        const dto = { irrigationEnabled: true, since: '2026-05-22T00:00:00.000Z' };
        mockFetch.mockResolvedValueOnce(jsonResponse(dto));

        await expect(getSystem()).resolves.toEqual(dto);
        expect(lastCall().url).toBe('http://test.local:9753/system');
    });

    it('POSTs /system/enable and returns the post-flip DTO.', async () => {
        const dto = { irrigationEnabled: true, since: '2026-05-22T01:00:00.000Z' };
        mockFetch.mockResolvedValueOnce(jsonResponse(dto));

        await expect(enableSystem()).resolves.toEqual(dto);
        const { url, init } = lastCall();
        expect(url).toBe('http://test.local:9753/system/enable');
        expect(init.method).toBe('POST');
    });

    it('POSTs /system/disable and returns the post-flip DTO.', async () => {
        const dto = { irrigationEnabled: false, since: '2026-05-22T01:30:00.000Z' };
        mockFetch.mockResolvedValueOnce(jsonResponse(dto));

        await disableSystem();
        const { url, init } = lastCall();
        expect(url).toBe('http://test.local:9753/system/disable');
        expect(init.method).toBe('POST');
    });
});

describe('zone endpoints', () => {
    it('GETs /zones and unwraps the { zones } envelope to a plain array.', async () => {
        const dto = [{ id: 'z-1', name: 'North' }];
        mockFetch.mockResolvedValueOnce(jsonResponse({ zones: dto }));

        await expect(getZones()).resolves.toEqual(dto);
        expect(lastCall().url).toBe('http://test.local:9753/zones');
    });

    it('POSTs to /zones/:id/open with URI-escaped id.', async () => {
        mockFetch.mockResolvedValueOnce(jsonResponse({ status: 'open', since: '...' }));

        await openZone('zone with spaces');
        const { url, init } = lastCall();
        expect(url).toBe('http://test.local:9753/zones/zone%20with%20spaces/open');
        expect(init.method).toBe('POST');
    });

    it('POSTs to /zones/:id/close.', async () => {
        mockFetch.mockResolvedValueOnce(jsonResponse({ status: 'closed' }));

        await closeZone('z-1');
        expect(lastCall().url).toBe('http://test.local:9753/zones/z-1/close');
    });

    it('POSTs to /zones/:id/run with the durationMin in the body.', async () => {
        mockFetch.mockResolvedValueOnce(jsonResponse({ status: 'open', since: '...', willCloseAt: '...' }));

        await runZone('z-1', 15);
        const { url, init } = lastCall();
        expect(url).toBe('http://test.local:9753/zones/z-1/run');
        expect(init.method).toBe('POST');
        expect(JSON.parse(init.body as string)).toEqual({ durationMin: 15 });
    });
});

describe('tonight endpoint', () => {
    it('GETs /tonight and returns the DTO unchanged.', async () => {
        const dto = { state: 'idle', zones: [], totalCycles: 0 };
        mockFetch.mockResolvedValueOnce(jsonResponse(dto));

        await expect(getTonight()).resolves.toEqual(dto);
        expect(lastCall().url).toBe('http://test.local:9753/tonight');
    });
});

describe('schedule endpoints', () => {
    it('GETs /schedules and returns the array directly.', async () => {
        const dto = [{ id: 's-1', slug: 'maintenance', isActive: true }];
        mockFetch.mockResolvedValueOnce(jsonResponse(dto));

        await expect(getSchedules()).resolves.toEqual(dto);
        expect(lastCall().url).toBe('http://test.local:9753/schedules');
    });

    it('POSTs to /schedule/enable/:slug.', async () => {
        mockFetch.mockResolvedValueOnce(jsonResponse({ status: 'enabled', schedule: { slug: 'maintenance', name: 'M', siteId: 's' } }));

        await enableSchedule('maintenance');
        const { url, init } = lastCall();
        expect(url).toBe('http://test.local:9753/schedule/enable/maintenance');
        expect(init.method).toBe('POST');
    });

    it('POSTs to /schedule/disable/:slug.', async () => {
        mockFetch.mockResolvedValueOnce(jsonResponse({ status: 'disabled', schedule: { slug: 'eco', name: 'E', siteId: 's' } }));

        await disableSchedule('eco');
        expect(lastCall().url).toBe('http://test.local:9753/schedule/disable/eco');
    });

    it('POSTs to /schedule/skip-tonight.', async () => {
        mockFetch.mockResolvedValueOnce(jsonResponse({ status: 'skipped', schedule: { slug: 'a', name: 'A', siteId: 's', skippedNightDate: '2026-05-22' } }));

        await skipScheduleTonight();
        expect(lastCall().url).toBe('http://test.local:9753/schedule/skip-tonight');
    });

    it('POSTs to /schedule/resume-tonight.', async () => {
        mockFetch.mockResolvedValueOnce(jsonResponse({ status: 'resumed', schedule: { slug: 'a', name: 'A', siteId: 's', skippedNightDate: null } }));

        await resumeScheduleTonight();
        expect(lastCall().url).toBe('http://test.local:9753/schedule/resume-tonight');
    });
});

describe('alerts endpoints', () => {
    it('GETs /alerts and unwraps the { alerts } envelope to a plain array.', async () => {
        const dto = [{ id: 'a-1', class: 'ha-call-failed', tone: 'danger', title: 't', sub: null, when: 'now', zoneId: null, ack: false }];
        mockFetch.mockResolvedValueOnce(jsonResponse({ alerts: dto }));

        await expect(getAlerts()).resolves.toEqual(dto);
        expect(lastCall().url).toBe('http://test.local:9753/alerts');
    });

    it('POSTs to /alerts/:id/ack and returns the status discriminator.', async () => {
        mockFetch.mockResolvedValueOnce(jsonResponse({ status: 'acked' }));

        await expect(ackAlert('a-1')).resolves.toBe('acked');
        const { url, init } = lastCall();
        expect(url).toBe('http://test.local:9753/alerts/a-1/ack');
        expect(init.method).toBe('POST');
    });

    it('returns the already-acked status when the api reports an idempotent retry.', async () => {
        mockFetch.mockResolvedValueOnce(jsonResponse({ status: 'already-acked' }));

        await expect(ackAlert('a-1')).resolves.toBe('already-acked');
    });
});

describe('activity endpoint', () => {
    it('GETs /activity with no query string when no params are passed.', async () => {
        mockFetch.mockResolvedValueOnce(jsonResponse({ activity: [], nextCursor: null }));

        await getActivity();
        expect(lastCall().url).toBe('http://test.local:9753/activity');
    });

    it('appends zoneId, limit, and cursor query params when provided.', async () => {
        mockFetch.mockResolvedValueOnce(jsonResponse({ activity: [], nextCursor: null }));

        await getActivity({ zoneId: 'z-1', limit: 25, cursor: 'opaque-cursor' });
        const url = new URL(lastCall().url);
        expect(url.pathname).toBe('/activity');
        expect(url.searchParams.get('zoneId')).toBe('z-1');
        expect(url.searchParams.get('limit')).toBe('25');
        expect(url.searchParams.get('cursor')).toBe('opaque-cursor');
    });

    it('omits unset params so the api uses its defaults.', async () => {
        mockFetch.mockResolvedValueOnce(jsonResponse({ activity: [], nextCursor: null }));

        await getActivity({ zoneId: 'z-1' });
        const url = new URL(lastCall().url);
        expect(url.searchParams.get('zoneId')).toBe('z-1');
        expect(url.searchParams.has('limit')).toBe(false);
        expect(url.searchParams.has('cursor')).toBe(false);
    });
});

describe('replan endpoint', () => {
    it('POSTs /replan.', async () => {
        mockFetch.mockResolvedValueOnce(jsonResponse({ status: 'replanned', lastRePlanAt: '2026-05-22T02:00:00.000Z' }));

        await replan();
        const { url, init } = lastCall();
        expect(url).toBe('http://test.local:9753/replan');
        expect(init.method).toBe('POST');
    });
});

describe('push registration endpoints', () => {
    it('POSTs /push/register with the registration body.', async () => {
        mockFetch.mockResolvedValueOnce(jsonResponse({ status: 'registered' }));

        await registerPushToken({ token: 'tok-1', platform: 'ios', userAgent: 'irrigo/1.0' });
        const { url, init } = lastCall();
        expect(url).toBe('http://test.local:9753/push/register');
        expect(init.method).toBe('POST');
        expect(JSON.parse(init.body as string)).toEqual({ token: 'tok-1', platform: 'ios', userAgent: 'irrigo/1.0' });
    });

    it('POSTs /push/unregister with the token wrapped in an object body.', async () => {
        mockFetch.mockResolvedValueOnce(jsonResponse({ status: 'unregistered' }));

        await unregisterPushToken('tok-1');
        const { url, init } = lastCall();
        expect(url).toBe('http://test.local:9753/push/unregister');
        expect(init.method).toBe('POST');
        expect(JSON.parse(init.body as string)).toEqual({ token: 'tok-1' });
    });
});
