import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { RefreshControl } from 'react-native';

jest.mock('expo-router', () => ({
    useRouter: () => ({ push: mockPush }),
}));

jest.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 44, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('expo-splash-screen', () => ({
    hideAsync: () => mockHideAsync(),
    preventAutoHideAsync: jest.fn(() => Promise.resolve()),
}));

import { buildApiWrapper, jsonResponse } from '@/api/test-utils';
import type { ScheduleListItem } from '@/api/types/schedules';
import type { NextRunDto } from '@/api/types/next-run';
import type { ZoneSummary } from '@/api/types/zones';

import { HomeView } from '.';

const mockPush = jest.fn();
const mockFetch = jest.fn();
const mockHideAsync = jest.fn(() => Promise.resolve());

const NOW = new Date('2026-05-24T15:00:00.000Z');
const SAMPLE_SYSTEM = { irrigationEnabled: true, since: '2026-05-23T00:00:00.000Z' };

const NEXT_RUN_SCHEDULED: NextRunDto = {
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

const SAMPLE_ZONES: ZoneSummary[] = [
    {
        id: 'zone-001',
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
        lastFiredAt: new Date(NOW.getTime() - 2 * 24 * 60 * 60_000).toISOString(),
        lastAppliedMm: 14,
        homeAssistantEntityId: 'switch.zone_north',
        patch: 'a',
        isRunning: false,
        willCloseAt: null,
    },
    {
        id: 'zone-002',
        slug: 'south',
        name: 'South',
        isEnabled: true,
        grassType: { name: 'Kentucky bluegrass' },
        soilType: { name: 'Loam' },
        areaM2: 180,
        rootDepthM: 0.22,
        allowableDepletionFraction: 0.5,
        irrigationEfficiency: 0.8,
        microclimateFactor: 1,
        precipitationRateMmPerHr: 10,
        currentDepletionMm: 11.2,
        rawMm: 28,
        lastFiredAt: new Date(NOW.getTime() - 24 * 60 * 60_000).toISOString(),
        lastAppliedMm: 9,
        homeAssistantEntityId: 'switch.zone_south',
        patch: 'b',
        isRunning: false,
        willCloseAt: null,
    },
];

const ACTIVE_SCHEDULE: ScheduleListItem = {
    id: 'sched-active',
    slug: 'maintenance',
    name: 'Maintenance',
    isActive: true,
    allowedDays: [3, 5, 7],
    allowedTimeWindows: [{ start: '22:00', end: '06:00' }],
    rootDepthMOverride: 0.18,
    allowableDepletionFractionOverride: 0.5,
    endBySunrise: true,
    nextRun: { inLabel: '8h 14m', whenLabel: 'tonight at 10:23pm', zonesLabel: 'North' },
    skippedTonight: false,
};

function setupSuccessfulFetch() {
    mockFetch.mockImplementation(async (input: RequestInfo) => {
        const url = typeof input === 'string' ? input : input.url;
        if (url.endsWith('/system')) return jsonResponse(SAMPLE_SYSTEM);
        if (url.endsWith('/tonight')) return jsonResponse(NEXT_RUN_SCHEDULED);
        if (url.endsWith('/zones')) return jsonResponse({ zones: SAMPLE_ZONES });
        if (url.endsWith('/schedules')) return jsonResponse([ACTIVE_SCHEDULE]);
        return jsonResponse({ error: 'unhandled url' }, 500);
    });
}

beforeEach(() => {
    (global as { fetch: typeof fetch }).fetch = mockFetch as unknown as typeof fetch;
    mockFetch.mockReset();
    mockPush.mockReset();
    mockHideAsync.mockClear();
    process.env.EXPO_PUBLIC_API_BASE_URL = 'http://test.local:9753';
});

describe('HomeView', () => {
    it('renders the next-run hero with the scheduled time.', async () => {
        setupSuccessfulFetch();
        render(<HomeView />, { wrapper: buildApiWrapper().wrapper });

        await waitFor(() => expect(screen.getByText('22:23')).toBeOnTheScreen());
    });

    it('does not render the outer "Next run · <timezone>" eyebrow above the hero card.', async () => {
        setupSuccessfulFetch();
        render(<HomeView />, { wrapper: buildApiWrapper().wrapper });

        // Wait for the page to stabilise, then assert the timezone-bearing
        // eyebrow is absent. The inner card's own "Next run" eyebrow stays.
        await waitFor(() => expect(screen.getByText('22:23')).toBeOnTheScreen());
        expect(screen.queryByText(/Next run · America\/Edmonton/)).toBeNull();
    });

    it('renders the next-run time in device-local time, ignoring NextRunDto.timezone (APP-88).', async () => {
        // The wire still carries a `timezone` field, but the client no longer
        // uses it — times render in the device-local zone (pinned to
        // America/Edmonton in jest-setup.ts). A bogus DTO timezone must not
        // move the displayed time off device-local.
        mockFetch.mockImplementation(async (input: RequestInfo) => {
            const url = typeof input === 'string' ? input : input.url;
            if (url.endsWith('/system')) return jsonResponse(SAMPLE_SYSTEM);
            if (url.endsWith('/tonight')) return jsonResponse({ ...NEXT_RUN_SCHEDULED, timezone: 'UTC' });
            if (url.endsWith('/zones')) return jsonResponse({ zones: SAMPLE_ZONES });
            if (url.endsWith('/schedules')) return jsonResponse([ACTIVE_SCHEDULE]);
            return jsonResponse({ error: 'unhandled url' }, 500);
        });
        render(<HomeView />, { wrapper: buildApiWrapper().wrapper });

        // 04:23Z reads as 22:23 MDT (device-local), not 04:23 (the UTC
        // reading the bogus DTO timezone would imply).
        await waitFor(() => expect(screen.getByText('22:23')).toBeOnTheScreen());
        expect(screen.queryByText('04:23')).toBeNull();
    });

    it('renders a zone tile for every zone returned by /zones.', async () => {
        setupSuccessfulFetch();
        render(<HomeView />, { wrapper: buildApiWrapper().wrapper });

        await waitFor(() => expect(screen.getByLabelText('Open North')).toBeOnTheScreen());
        expect(screen.getByLabelText('Open South')).toBeOnTheScreen();
    });

    it('renders the soil-moisture legend above the zone tiles (APP-45).', async () => {
        setupSuccessfulFetch();
        render(<HomeView />, { wrapper: buildApiWrapper().wrapper });

        await waitFor(() => expect(screen.getByLabelText('Open North')).toBeOnTheScreen());
        expect(screen.getByLabelText('Soil moisture legend')).toBeOnTheScreen();
        expect(screen.getByText('On track')).toBeOnTheScreen();
        expect(screen.getByText('Approaching limit')).toBeOnTheScreen();
        expect(screen.getByText('Limit exceeded')).toBeOnTheScreen();
    });

    it('renders the zones-section meta with the total area.', async () => {
        setupSuccessfulFetch();
        render(<HomeView />, { wrapper: buildApiWrapper().wrapper });

        await waitFor(() => expect(screen.getByText('2 · 500 m²')).toBeOnTheScreen());
    });

    it('renders the active-schedule chip when a schedule is marked active.', async () => {
        setupSuccessfulFetch();
        render(<HomeView />, { wrapper: buildApiWrapper().wrapper });

        await waitFor(() => expect(screen.getByText('Maintenance')).toBeOnTheScreen());
        expect(screen.getByText('8h 14m')).toBeOnTheScreen();
    });

    it('hides the chip RUNNING badge when next-run state is scheduled (not firing).', async () => {
        setupSuccessfulFetch();
        render(<HomeView />, { wrapper: buildApiWrapper().wrapper });

        await waitFor(() => expect(screen.getByText('Maintenance')).toBeOnTheScreen());
        expect(screen.queryByText('RUNNING')).toBeNull();
    });

    it('shows the chip RUNNING badge when next-run state is firing.', async () => {
        mockFetch.mockImplementation(async (input: RequestInfo) => {
            const url = typeof input === 'string' ? input : input.url;
            if (url.endsWith('/system')) return jsonResponse(SAMPLE_SYSTEM);
            if (url.endsWith('/tonight')) return jsonResponse({ ...NEXT_RUN_SCHEDULED, state: 'firing' });
            if (url.endsWith('/zones')) return jsonResponse({ zones: SAMPLE_ZONES });
            if (url.endsWith('/schedules')) return jsonResponse([ACTIVE_SCHEDULE]);
            return jsonResponse({ error: 'unhandled' }, 500);
        });

        render(<HomeView />, { wrapper: buildApiWrapper().wrapper });

        await waitFor(() => expect(screen.getByText('RUNNING')).toBeOnTheScreen());
    });

    it('routes to /zone/<slug> when a zone tile is pressed.', async () => {
        setupSuccessfulFetch();
        render(<HomeView />, { wrapper: buildApiWrapper().wrapper });

        await waitFor(() => expect(screen.getByLabelText('Open North')).toBeOnTheScreen());

        fireEvent.press(screen.getByLabelText('Open North'));

        expect(mockPush).toHaveBeenCalledWith('/zone/north');
    });

    it('routes to /schedules when the active-schedule chip is pressed.', async () => {
        setupSuccessfulFetch();
        render(<HomeView />, { wrapper: buildApiWrapper().wrapper });

        await waitFor(() =>
            expect(screen.getByLabelText('Open Schedules — active profile Maintenance')).toBeOnTheScreen(),
        );

        fireEvent.press(screen.getByLabelText('Open Schedules — active profile Maintenance'));

        expect(mockPush).toHaveBeenCalledWith('/schedules');
    });

    it('renders loading placeholders while the hooks are pending.', () => {
        mockFetch.mockImplementation(() => new Promise(() => {})); // never resolves
        render(<HomeView />, { wrapper: buildApiWrapper().wrapper });

        expect(screen.getByText('Loading next run…')).toBeOnTheScreen();
        expect(screen.getByText('Loading zones…')).toBeOnTheScreen();
    });

    it('renders error placeholders when /tonight (next-run) returns null body (not just on error).', async () => {
        // apiFetch returns `null` when the response is 2xx but the body is
        // missing or unparseable. The next-run hero would crash on a null
        // payload, so the guard must catch both undefined and null.
        mockFetch.mockImplementation(async (input: RequestInfo) => {
            const url = typeof input === 'string' ? input : input.url;
            if (url.endsWith('/system')) return jsonResponse(SAMPLE_SYSTEM);
            if (url.endsWith('/tonight')) return jsonResponse(null);
            if (url.endsWith('/zones')) return jsonResponse({ zones: SAMPLE_ZONES });
            if (url.endsWith('/schedules')) return jsonResponse([ACTIVE_SCHEDULE]);
            return jsonResponse({ error: 'unhandled' }, 500);
        });

        render(<HomeView />, { wrapper: buildApiWrapper().wrapper });

        await waitFor(() => expect(screen.getByText('Failed to load next run.')).toBeOnTheScreen());
    });

    it('renders error placeholders when /tonight (next-run) and /zones fail.', async () => {
        mockFetch.mockImplementation(async (input: RequestInfo) => {
            const url = typeof input === 'string' ? input : input.url;
            if (url.endsWith('/system')) return jsonResponse(SAMPLE_SYSTEM);
            return jsonResponse({ error: 'boom' }, 500);
        });

        render(<HomeView />, { wrapper: buildApiWrapper().wrapper });

        await waitFor(() => expect(screen.getByText('Failed to load next run.')).toBeOnTheScreen());
        expect(screen.getByText('Failed to load zones.')).toBeOnTheScreen();
    });

    it('omits the active-schedule chip when no schedule is active.', async () => {
        mockFetch.mockImplementation(async (input: RequestInfo) => {
            const url = typeof input === 'string' ? input : input.url;
            if (url.endsWith('/system')) return jsonResponse(SAMPLE_SYSTEM);
            if (url.endsWith('/tonight')) return jsonResponse(NEXT_RUN_SCHEDULED);
            if (url.endsWith('/zones')) return jsonResponse({ zones: SAMPLE_ZONES });
            if (url.endsWith('/schedules')) return jsonResponse([{ ...ACTIVE_SCHEDULE, isActive: false }]);
            return jsonResponse({ error: 'unhandled' }, 500);
        });

        render(<HomeView />, { wrapper: buildApiWrapper().wrapper });

        await waitFor(() => expect(screen.getByLabelText('Open North')).toBeOnTheScreen());
        expect(screen.queryByText('Maintenance')).toBeNull();
    });

    it('disables the body via SystemDisabledWrapper when irrigation is off.', async () => {
        mockFetch.mockImplementation(async (input: RequestInfo) => {
            const url = typeof input === 'string' ? input : input.url;
            if (url.endsWith('/system')) return jsonResponse({ ...SAMPLE_SYSTEM, irrigationEnabled: false });
            if (url.endsWith('/tonight')) return jsonResponse(NEXT_RUN_SCHEDULED);
            if (url.endsWith('/zones')) return jsonResponse({ zones: SAMPLE_ZONES });
            if (url.endsWith('/schedules')) return jsonResponse([ACTIVE_SCHEDULE]);
            return jsonResponse({ error: 'unhandled' }, 500);
        });

        const { root } = render(<HomeView />, { wrapper: buildApiWrapper().wrapper });

        // The wrapper sets accessibilityElementsHidden=true once the system
        // query resolves with `irrigationEnabled: false`. Wait for that
        // state to flow through React Query → re-render → tree update.
        await waitFor(() => {
            const dimmed = root.findAll(node =>
                typeof node.type === 'string'
                && node.props.accessibilityElementsHidden === true,
            );
            expect(dimmed.length).toBeGreaterThan(0);
        });
    });

    it('does not drop the splash while any of the four home queries is still pending (APP-51).', () => {
        mockFetch.mockImplementation(() => new Promise(() => {})); // never resolves

        render(<HomeView />, { wrapper: buildApiWrapper().wrapper });

        expect(mockHideAsync).not.toHaveBeenCalled();
    });

    it('drops the splash exactly once the four home queries settle (APP-51).', async () => {
        setupSuccessfulFetch();

        render(<HomeView />, { wrapper: buildApiWrapper().wrapper });

        await waitFor(() => expect(mockHideAsync).toHaveBeenCalledTimes(1));
    });

    it('drops the splash when a query resolves to an error rather than holding forever (APP-51).', async () => {
        // /tonight errors; the other three succeed. The home view's error
        // placeholder handles the visible state — we just need the splash
        // to drop rather than block on the failed query.
        mockFetch.mockImplementation(async (input: RequestInfo) => {
            const url = typeof input === 'string' ? input : input.url;
            if (url.endsWith('/system')) return jsonResponse(SAMPLE_SYSTEM);
            if (url.endsWith('/tonight')) return jsonResponse({ error: 'boom' }, 500);
            if (url.endsWith('/zones')) return jsonResponse({ zones: SAMPLE_ZONES });
            if (url.endsWith('/schedules')) return jsonResponse([ACTIVE_SCHEDULE]);
            return jsonResponse({ error: 'unhandled' }, 500);
        });

        render(<HomeView />, { wrapper: buildApiWrapper().wrapper });

        await waitFor(() => expect(mockHideAsync).toHaveBeenCalledTimes(1));
    });

    it('mounts a RefreshControl so pull-to-refresh stays wired in (APP-40).', () => {
        mockFetch.mockImplementation(() => new Promise(() => {}));

        render(<HomeView />, { wrapper: buildApiWrapper().wrapper });

        expect(screen.UNSAFE_getByType(RefreshControl)).toBeTruthy();
    });

    it('drops the splash via the 30-second backstop if the API never responds (APP-51).', () => {
        jest.useFakeTimers();
        try {
            // Use a non-fake-timer-aware QueryClient: queries never resolve
            // because fetch never settles, so dataReady stays false. The
            // backstop is the only escape.
            mockFetch.mockImplementation(() => new Promise(() => {}));
            const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

            render(<HomeView />, { wrapper: buildApiWrapper().wrapper });
            expect(mockHideAsync).not.toHaveBeenCalled();

            act(() => {
                jest.advanceTimersByTime(30_000);
            });

            expect(mockHideAsync).toHaveBeenCalledTimes(1);
            expect(warnSpy.mock.calls.some(call => String(call[0]).includes('backstop'))).toBe(true);
            warnSpy.mockRestore();
        } finally {
            jest.useRealTimers();
        }
    });
});
