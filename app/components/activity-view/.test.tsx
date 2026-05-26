import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { RefreshControl } from 'react-native';

jest.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 44, bottom: 0, left: 0, right: 0 }),
}));

import type { ActivityDto, ActivityListResult } from '@/api/types/activity';
import type { AlertDto } from '@/api/types/alerts';
import type { NextRunDto } from '@/api/types/next-run';
import type { ZoneSummary } from '@/api/types/zones';
import { keys } from '@/api/query-keys';
import { buildApiWrapper, jsonResponse } from '@/api/test-utils';

import { ActivityView } from '.';

const mockFetch = jest.fn();

function buildZone(overrides?: Partial<ZoneSummary>): ZoneSummary {
    return {
        id: 'z-1',
        slug: 'north',
        name: 'North',
        isEnabled: true,
        grassType: { name: 'Fescue' },
        soilType: { name: 'Loam' },
        areaM2: 320,
        rootDepthM: 0.18,
        allowableDepletionFraction: 0.5,
        irrigationEfficiency: 0.8,
        microclimateFactor: 1,
        precipitationRateMmPerHr: 10,
        currentDepletionMm: 14.4,
        rawMm: 32,
        lastFiredAt: null,
        lastAppliedMm: null,
        homeAssistantEntityId: 'switch.zone_north',
        patch: 'a',
        ...overrides,
    };
}

const ZONES: ZoneSummary[] = [
    buildZone({ id: 'z-1', slug: 'north', name: 'North' }),
    buildZone({ id: 'z-2', slug: 'south', name: 'South' }),
];

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

    it('does not surface alerts inline — alerts have no in-screen dismiss affordance, so we keep them off Activity.', async () => {
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

        // Wait for the activity rows to settle (proves the screen rendered).
        await waitFor(() => expect(screen.getByText('14.0 mm · 62 min')).toBeOnTheScreen());
        // Even with an active alert in the cache, the screen omits it.
        expect(screen.queryByText('Weather API stale')).toBeNull();
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

    it('renders the "All zones" chip plus one chip per zone returned by /zones (APP-61).', async () => {
        const { wrapper, client } = buildApiWrapper();
        client.setQueryData(keys.zones.list(), ZONES);
        client.setQueryData(keys.activity.list({}), {
            pages: [activityResult([buildActivity()])],
            pageParams: [undefined],
        });

        render(<ActivityView />, { wrapper });

        expect(screen.getByText('All zones')).toBeOnTheScreen();
        expect(screen.getByText('North')).toBeOnTheScreen();
        expect(screen.getByText('South')).toBeOnTheScreen();
        await waitFor(() => expect(screen.getByLabelText('Show all zones').props.accessibilityState).toMatchObject({ selected: true }));
    });

    it('refetches /activity scoped to the selected zone when a zone chip is tapped (APP-61).', async () => {
        const { wrapper, client } = buildApiWrapper();
        client.setQueryData(keys.zones.list(), ZONES);
        mockFetch.mockImplementation(async (input: RequestInfo) => {
            const url = typeof input === 'string' ? input : input.url;
            if (url.includes('/activity')) return jsonResponse(activityResult([buildActivity()]));
            return jsonResponse({ error: 'unhandled' }, 500);
        });

        render(<ActivityView />, { wrapper });

        // Wait for the default (no-filter) activity fetch to settle.
        await waitFor(() => {
            const calls = mockFetch.mock.calls.filter(([u]) => String(u).includes('/activity'));
            expect(calls.length).toBeGreaterThan(0);
        });

        await act(async () => {
            fireEvent.press(screen.getByLabelText('Filter to North'));
        });

        await waitFor(() => {
            const scopedCall = mockFetch.mock.calls.find(([u]) => {
                const url = new URL(String(u));
                return url.pathname === '/activity' && url.searchParams.get('zoneId') === 'z-1';
            });
            expect(scopedCall).toBeDefined();
        });
    });

    it('refetches /activity without the zoneId param when "All zones" is tapped after a zone selection (APP-61).', async () => {
        const { wrapper, client } = buildApiWrapper();
        client.setQueryData(keys.zones.list(), ZONES);
        mockFetch.mockImplementation(async (input: RequestInfo) => {
            const url = typeof input === 'string' ? input : input.url;
            if (url.includes('/activity')) return jsonResponse(activityResult([buildActivity()]));
            return jsonResponse({ error: 'unhandled' }, 500);
        });

        render(<ActivityView />, { wrapper });

        // Pick a zone first.
        await act(async () => {
            fireEvent.press(screen.getByLabelText('Filter to South'));
        });
        // Then clear back to All zones.
        await act(async () => {
            fireEvent.press(screen.getByLabelText('Show all zones'));
        });

        await waitFor(() => {
            const lastCall = mockFetch.mock.calls
                .map(([u]) => new URL(String(u)))
                .reverse()
                .find(url => url.pathname === '/activity');
            expect(lastCall).toBeDefined();
            expect(lastCall?.searchParams.has('zoneId')).toBe(false);
        });
    });

    it('mounts a RefreshControl so pull-to-refresh stays wired in (APP-40).', () => {
        const { wrapper } = buildApiWrapper();
        mockFetch.mockImplementation(() => new Promise(() => {}));

        render(<ActivityView />, { wrapper });

        expect(screen.UNSAFE_getByType(RefreshControl)).toBeTruthy();
    });

    it('updates the eyebrow suffix to the zone name when a zone is selected (APP-61).', async () => {
        const { wrapper, client } = buildApiWrapper();
        client.setQueryData(keys.zones.list(), ZONES);
        mockFetch.mockImplementation(async () => jsonResponse(activityResult([buildActivity()])));

        render(<ActivityView />, { wrapper });

        expect(screen.getByText('Chronological · all zones')).toBeOnTheScreen();

        await act(async () => {
            fireEvent.press(screen.getByLabelText('Filter to South'));
        });

        await waitFor(() => expect(screen.getByText('Chronological · South')).toBeOnTheScreen());
    });
});
