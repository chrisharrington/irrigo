import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

jest.mock('expo-router', () => ({
    useRouter: () => ({ push: mockPush }),
}));

jest.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 44, bottom: 0, left: 0, right: 0 }),
}));

import { buildApiWrapper, jsonResponse } from '@/api/test-utils';
import type { ScheduleListItem } from '@/api/types/schedules';
import type { TonightDto } from '@/api/types/tonight';
import type { ZoneSummary } from '@/api/types/zones';

import { HomeView } from '.';

const mockPush = jest.fn();
const mockFetch = jest.fn();

const NOW = new Date('2026-05-24T15:00:00.000Z');
const SAMPLE_SYSTEM = { irrigationEnabled: true, since: '2026-05-23T00:00:00.000Z' };

const TONIGHT_SCHEDULED: TonightDto = {
    state: 'scheduled',
    startTime: '2026-05-24T04:23:00.000Z',
    endsAt: '2026-05-24T11:48:00.000Z',
    axisStart: '22:00',
    axisEnd: '06:00',
    sunset: '20:45',
    sunrise: '05:30',
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
        if (url.endsWith('/tonight')) return jsonResponse(TONIGHT_SCHEDULED);
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
    it('renders the eyebrow with the site timezone label.', async () => {
        setupSuccessfulFetch();
        render(<HomeView />, { wrapper: buildApiWrapper().wrapper });

        await waitFor(() => expect(screen.getByText('Tonight · America/Edmonton')).toBeOnTheScreen());
    });

    it('renders the next-run hero with the scheduled time.', async () => {
        setupSuccessfulFetch();
        render(<HomeView />, { wrapper: buildApiWrapper().wrapper });

        await waitFor(() => expect(screen.getByText('10:23 pm')).toBeOnTheScreen());
    });

    it('renders a zone tile for every zone returned by /zones.', async () => {
        setupSuccessfulFetch();
        render(<HomeView />, { wrapper: buildApiWrapper().wrapper });

        await waitFor(() => expect(screen.getByLabelText('Open North')).toBeOnTheScreen());
        expect(screen.getByLabelText('Open South')).toBeOnTheScreen();
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

        expect(screen.getByText('Loading tonight…')).toBeOnTheScreen();
        expect(screen.getByText('Loading zones…')).toBeOnTheScreen();
    });

    it('renders error placeholders when /tonight and /zones fail.', async () => {
        mockFetch.mockImplementation(async (input: RequestInfo) => {
            const url = typeof input === 'string' ? input : input.url;
            if (url.endsWith('/system')) return jsonResponse(SAMPLE_SYSTEM);
            return jsonResponse({ error: 'boom' }, 500);
        });

        render(<HomeView />, { wrapper: buildApiWrapper().wrapper });

        await waitFor(() => expect(screen.getByText('Failed to load tonight.')).toBeOnTheScreen());
        expect(screen.getByText('Failed to load zones.')).toBeOnTheScreen();
    });

    it('omits the active-schedule chip when no schedule is active.', async () => {
        mockFetch.mockImplementation(async (input: RequestInfo) => {
            const url = typeof input === 'string' ? input : input.url;
            if (url.endsWith('/system')) return jsonResponse(SAMPLE_SYSTEM);
            if (url.endsWith('/tonight')) return jsonResponse(TONIGHT_SCHEDULED);
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
            if (url.endsWith('/tonight')) return jsonResponse(TONIGHT_SCHEDULED);
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
