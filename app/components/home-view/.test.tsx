import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

jest.mock('expo-router', () => ({
    useRouter: () => ({ push: mockPush }),
}));

jest.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 44, bottom: 0, left: 0, right: 0 }),
}));

import { buildApiWrapper, jsonResponse } from '@/api/test-utils';
import type { ScheduleListItem } from '@/api/types/schedules';
import type { NextRunDto } from '@/api/types/next-run';
import type { ZoneSummary } from '@/api/types/zones';

import { HomeView } from '.';

const mockPush = jest.fn();
const mockFetch = jest.fn();

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
    process.env.EXPO_PUBLIC_API_BASE_URL = 'http://test.local:9753';
});

describe('HomeView', () => {
    it('renders the next-run hero with the scheduled time.', async () => {
        setupSuccessfulFetch();
        render(<HomeView />, { wrapper: buildApiWrapper().wrapper });

        await waitFor(() => expect(screen.getByText('10:23 pm')).toBeOnTheScreen());
    });

    it('does not render the outer "Next run · <timezone>" eyebrow above the hero card.', async () => {
        setupSuccessfulFetch();
        render(<HomeView />, { wrapper: buildApiWrapper().wrapper });

        // Wait for the page to stabilise, then assert the timezone-bearing
        // eyebrow is absent. The inner card's own "Next run" eyebrow stays.
        await waitFor(() => expect(screen.getByText('10:23 pm')).toBeOnTheScreen());
        expect(screen.queryByText(/Next run · America\/Edmonton/)).toBeNull();
    });

    it('formats the next-run time in the API-provided timezone — env-var EXPO_PUBLIC_SITE_TIMEZONE has no influence (APP-54).', async () => {
        // Set the env-var hypothesis to a *wrong* timezone. The displayed
        // time must still match the API's `timezone` field (Edmonton), not
        // the env-var override (UTC), which would render as 4:23 am.
        const saved = process.env.EXPO_PUBLIC_SITE_TIMEZONE;
        process.env.EXPO_PUBLIC_SITE_TIMEZONE = 'UTC';
        try {
            setupSuccessfulFetch();
            render(<HomeView />, { wrapper: buildApiWrapper().wrapper });

            await waitFor(() => expect(screen.getByText('10:23 pm')).toBeOnTheScreen());
            expect(screen.queryByText('4:23 am')).toBeNull();
        } finally {
            if (saved === undefined) delete process.env.EXPO_PUBLIC_SITE_TIMEZONE;
            else process.env.EXPO_PUBLIC_SITE_TIMEZONE = saved;
        }
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
        // The fixture's zones are healthy (not past RAW), so 'Runs tonight'
        // only appears inside the legend — the lookup is unambiguous.
        expect(screen.getByText('Runs tonight')).toBeOnTheScreen();
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
});
