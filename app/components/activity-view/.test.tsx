import { render, screen, waitFor } from '@testing-library/react-native';

jest.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 44, bottom: 0, left: 0, right: 0 }),
}));

import type { ActivityDto, ActivityListResult } from '@/api/types/activity';
import type { AlertDto } from '@/api/types/alerts';
import type { NextRunDto } from '@/api/types/next-run';
import { keys } from '@/api/query-keys';
import { buildApiWrapper, jsonResponse } from '@/api/test-utils';

import { ActivityView } from '.';

const mockFetch = jest.fn();

const NEXT_RUN: NextRunDto = {
    state: 'scheduled',
    startTime: '2026-05-24T04:23:00.000Z',
    endsAt: '2026-05-24T11:48:00.000Z',
    axisStart: '22:00',
    axisEnd: '06:00',
    sunset: '20:45',
    sunrise: '05:30',
    timezone: 'America/Edmonton',
    zoneOrder: ['North'],
    totalCycles: 5,
    zones: [{ name: 'North', slug: 'north', patch: 'a', cycles: [{ start: '22:23', durMin: 15 }] }],
};

function buildActivity(overrides?: Partial<ActivityDto>): ActivityDto {
    return {
        id: 'a-1',
        // 09:00 MDT on 2026-05-13 → 'May 13' in America/Edmonton.
        date: '2026-05-13T15:00:00.000Z',
        zone: { id: 'z-1', name: 'North', slug: 'north' },
        appliedDepthMm: 14,
        durationMin: 62,
        depletionBeforeMm: 30,
        depletionAfterMm: 16,
        source: 'planner',
        ...overrides,
    };
}

function activityResult(rows: ActivityDto[], nextCursor: string | null = null): ActivityListResult {
    return { activity: rows, nextCursor };
}

beforeEach(() => {
    (global as { fetch: typeof fetch }).fetch = mockFetch as unknown as typeof fetch;
    mockFetch.mockReset();
    process.env.EXPO_PUBLIC_API_BASE_URL = 'http://test.local:9753';
});

describe('ActivityView', () => {
    it('renders the eyebrow and page title.', () => {
        const { wrapper } = buildApiWrapper();
        mockFetch.mockImplementation(() => new Promise(() => {}));

        render(<ActivityView />, { wrapper });

        expect(screen.getByText('Chronological · all zones')).toBeOnTheScreen();
        expect(screen.getByText('Activity')).toBeOnTheScreen();
    });

    it('renders a fire-log row for each activity entry returned by /activity.', async () => {
        const { wrapper, client } = buildApiWrapper();
        client.setQueryData(keys.nextRun.summary(), NEXT_RUN);
        mockFetch.mockImplementation(async (input: RequestInfo) => {
            const url = typeof input === 'string' ? input : input.url;
            if (url.includes('/activity')) {
                return jsonResponse(activityResult([
                    buildActivity({ id: 'a-1', appliedDepthMm: 14, durationMin: 62 }),
                    buildActivity({ id: 'a-2', appliedDepthMm: 9, durationMin: 51 }),
                ]));
            }
            return jsonResponse({ error: 'unhandled' }, 500);
        });

        render(<ActivityView />, { wrapper });

        await waitFor(() => expect(screen.getByText('14.0 mm · 62 min')).toBeOnTheScreen());
        expect(screen.getByText('9.0 mm · 51 min')).toBeOnTheScreen();
    });

    it('renders the alert region above the fire log when active alerts exist.', async () => {
        const alert: AlertDto = {
            id: 'al-1',
            class: 'weather-stale',
            tone: 'warn',
            title: 'Weather API stale',
            sub: null,
            when: '2026-05-24T11:00:00.000Z',
            zoneId: null,
            ack: false,
        };
        const { wrapper, client } = buildApiWrapper();
        client.setQueryData(keys.alerts.list(), [alert]);
        client.setQueryData(keys.nextRun.summary(), NEXT_RUN);
        mockFetch.mockImplementation(async () => jsonResponse(activityResult([buildActivity()])));

        render(<ActivityView />, { wrapper });

        await waitFor(() => expect(screen.getByText('Weather API stale')).toBeOnTheScreen());
    });

    it('renders the loading placeholder while /activity is pending.', () => {
        const { wrapper } = buildApiWrapper();
        mockFetch.mockImplementation(() => new Promise(() => {}));

        render(<ActivityView />, { wrapper });

        expect(screen.getByText('Loading activity…')).toBeOnTheScreen();
    });

    it('renders the error placeholder when /activity fails.', async () => {
        const { wrapper } = buildApiWrapper();
        mockFetch.mockResolvedValueOnce(jsonResponse({ error: 'boom' }, 500));

        render(<ActivityView />, { wrapper });

        await waitFor(() => expect(screen.getByText('Failed to load activity.')).toBeOnTheScreen());
    });

    it('renders the empty placeholder when /activity returns no rows.', async () => {
        const { wrapper } = buildApiWrapper();
        mockFetch.mockImplementation(async () => jsonResponse(activityResult([])));

        render(<ActivityView />, { wrapper });

        await waitFor(() => expect(screen.getByText('No runs yet.')).toBeOnTheScreen());
    });

    it('falls back to UTC for the date label when the next-run cache is unprimed.', async () => {
        const { wrapper } = buildApiWrapper();
        mockFetch.mockImplementation(async (input: RequestInfo) => {
            const url = typeof input === 'string' ? input : input.url;
            if (url.includes('/activity')) {
                return jsonResponse(activityResult([
                    // 03:00 UTC on 2026-05-14 — same instant is 21:00 May 13
                    // in Edmonton. A UTC fallback renders it as 'May 14'.
                    buildActivity({ id: 'a-1', date: '2026-05-14T03:00:00.000Z' }),
                ]));
            }
            return jsonResponse({ error: 'unhandled' }, 500);
        });

        render(<ActivityView />, { wrapper });

        await waitFor(() => expect(screen.getByText('May 14')).toBeOnTheScreen());
    });

    it('flattens multi-page infinite-query results into a single visible list.', () => {
        const { wrapper, client } = buildApiWrapper();
        client.setQueryData(keys.nextRun.summary(), NEXT_RUN);
        // Seed two pre-baked pages so the view doesn't have to fetch.
        client.setQueryData(keys.activity.list({}), {
            pages: [
                activityResult([buildActivity({ id: 'a-1', appliedDepthMm: 5, durationMin: 30 })], 'cursor-2'),
                activityResult([buildActivity({ id: 'a-2', appliedDepthMm: 8, durationMin: 40 })], null),
            ],
            pageParams: [undefined, 'cursor-2'],
        });

        render(<ActivityView />, { wrapper });

        expect(screen.getByText('5.0 mm · 30 min')).toBeOnTheScreen();
        expect(screen.getByText('8.0 mm · 40 min')).toBeOnTheScreen();
    });
});
