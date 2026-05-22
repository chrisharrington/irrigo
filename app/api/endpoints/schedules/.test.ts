import { jsonResponse } from '@/api/test-helpers';
import {
    disableSchedule,
    enableSchedule,
    getSchedules,
    resumeScheduleTonight,
    skipScheduleTonight,
} from '.';

const mockFetch = jest.fn();

beforeEach(() => {
    (global as { fetch: typeof fetch }).fetch = mockFetch as unknown as typeof fetch;
    mockFetch.mockReset();
    process.env.EXPO_PUBLIC_API_BASE_URL = 'http://test.local:9753';
});

function lastUrl(): string {
    return (mockFetch.mock.calls.at(-1) as [string, RequestInit])[0];
}

describe('getSchedules', () => {
    it('GETs /schedules and returns the array directly.', async () => {
        const dto = [{ id: 's-1', slug: 'maintenance', isActive: true }];
        mockFetch.mockResolvedValueOnce(jsonResponse(dto));

        await expect(getSchedules()).resolves.toEqual(dto);
        expect(lastUrl()).toBe('http://test.local:9753/schedules');
    });
});

describe('enableSchedule', () => {
    it('POSTs to /schedule/enable/:slug.', async () => {
        mockFetch.mockResolvedValueOnce(jsonResponse({ status: 'enabled', schedule: { slug: 'maintenance', name: 'M', siteId: 's' } }));

        await enableSchedule('maintenance');
        expect(lastUrl()).toBe('http://test.local:9753/schedule/enable/maintenance');
    });
});

describe('disableSchedule', () => {
    it('POSTs to /schedule/disable/:slug.', async () => {
        mockFetch.mockResolvedValueOnce(jsonResponse({ status: 'disabled', schedule: { slug: 'eco', name: 'E', siteId: 's' } }));

        await disableSchedule('eco');
        expect(lastUrl()).toBe('http://test.local:9753/schedule/disable/eco');
    });
});

describe('skipScheduleTonight', () => {
    it('POSTs to /schedule/skip-tonight.', async () => {
        mockFetch.mockResolvedValueOnce(jsonResponse({ status: 'skipped', schedule: { slug: 'a', name: 'A', siteId: 's', skippedNightDate: '2026-05-22' } }));

        await skipScheduleTonight();
        expect(lastUrl()).toBe('http://test.local:9753/schedule/skip-tonight');
    });
});

describe('resumeScheduleTonight', () => {
    it('POSTs to /schedule/resume-tonight.', async () => {
        mockFetch.mockResolvedValueOnce(jsonResponse({ status: 'resumed', schedule: { slug: 'a', name: 'A', siteId: 's', skippedNightDate: null } }));

        await resumeScheduleTonight();
        expect(lastUrl()).toBe('http://test.local:9753/schedule/resume-tonight');
    });
});
