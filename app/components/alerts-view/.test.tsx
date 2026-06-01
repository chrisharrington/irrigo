import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';

import { buildApiWrapper, jsonResponse } from '@/api/test-utils';
import { keys } from '@/api/query-keys';
import type { AlertDto } from '@/api/types/alerts';

// Kept for the EmptyState child, which calls useRouter().push. AlertsView
// itself no longer navigates after the header (and its back button) were
// removed in APP-82.
const mockRouterPush = jest.fn();

jest.mock('expo-router', () => ({
    useRouter: () => ({ push: mockRouterPush }),
}));

jest.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 24, bottom: 0, left: 0, right: 0 }),
}));

import { AlertsView } from '.';

// The test env is pinned to America/Edmonton (TZ in package.json), so alert
// timestamps render device-local as MDT (UTC-6).
const NOW = new Date('2026-05-29T20:30:00.000Z'); // 14:30 device-local

const mockFetch = jest.fn();

// Holds the alerts the GET /alerts poll should echo back. `useAlerts` polls
// on a 30s interval and refetches on mount; routing the GET to the same data
// the test seeded keeps React Query's structural sharing a no-op (no stray
// re-render) instead of clobbering the cache with the generic ack response.
let currentAlerts: readonly AlertDto[] = [];

beforeEach(() => {
    (global as { fetch: typeof fetch }).fetch = mockFetch as unknown as typeof fetch;
    mockFetch.mockReset();
    currentAlerts = [];
    mockFetch.mockImplementation((input: unknown) => {
        const url = String(input);
        if (url.includes('/ack')) return Promise.resolve(jsonResponse({ status: 'acked' }));
        if (url.endsWith('/alerts')) return Promise.resolve(jsonResponse({ alerts: currentAlerts }));
        return Promise.resolve(jsonResponse({}));
    });
    mockRouterPush.mockReset();
    process.env.EXPO_PUBLIC_API_BASE_URL = 'http://test.local:9753';
});

function buildAlert(overrides?: Partial<AlertDto>): AlertDto {
    return {
        id: 'a-1',
        class: 'ha-call-failed',
        tone: 'danger',
        title: 'Controller unreachable',
        sub: 'HA has not responded.',
        when: '2026-05-29T20:02:00.000Z', // 14:02 site-local — `new`
        zoneId: null,
        ack: false,
        ...overrides,
    };
}

/** Builds a wrapper with the alerts list pre-seeded. */
function seed(alerts: readonly AlertDto[]) {
    const { wrapper, client } = buildApiWrapper();
    currentAlerts = alerts;
    client.setQueryData(keys.alerts.list(), alerts);
    return wrapper;
}

describe('AlertsView', () => {
    it('renders the page heading and unread/total summary.', () => {
        const wrapper = seed([
            buildAlert({ id: 'a-1', ack: false }),
            buildAlert({ id: 'a-2', ack: true, title: 'Forecast stale', tone: 'warn', class: 'weather-stale' }),
        ]);

        render(<AlertsView now={NOW} />, { wrapper });

        expect(screen.getByText('Recent alerts')).toBeOnTheScreen();
        expect(screen.getByText('1 unread · 2 total')).toBeOnTheScreen();
    });

    it('shows a per-filter count on each chip.', () => {
        const wrapper = seed([
            buildAlert({ id: 'a-1', tone: 'danger', ack: false }), // unread + critical
            buildAlert({ id: 'a-2', tone: 'warn', class: 'weather-stale', ack: true }), // neither
        ]);

        render(<AlertsView now={NOW} />, { wrapper });

        // All = 2, Unread = 1, Critical (danger-only) = 1.
        expect(within(screen.getByLabelText('All')).getByText('2')).toBeOnTheScreen();
        expect(within(screen.getByLabelText('Unread')).getByText('1')).toBeOnTheScreen();
        expect(within(screen.getByLabelText('Critical')).getByText('1')).toBeOnTheScreen();
    });

    it('shows every alert under the All filter by default.', () => {
        const wrapper = seed([
            buildAlert({ id: 'a-1', title: 'Controller unreachable' }),
            buildAlert({ id: 'a-2', title: 'Forecast stale', tone: 'warn', class: 'weather-stale', ack: true }),
        ]);

        render(<AlertsView now={NOW} />, { wrapper });

        expect(screen.getByText('Controller unreachable')).toBeOnTheScreen();
        expect(screen.getByText('Forecast stale')).toBeOnTheScreen();
    });

    it('filters to unread alerts when the Unread chip is selected.', () => {
        const wrapper = seed([
            buildAlert({ id: 'a-1', title: 'Controller unreachable', ack: false }),
            buildAlert({ id: 'a-2', title: 'Forecast stale', tone: 'warn', class: 'weather-stale', ack: true }),
        ]);

        render(<AlertsView now={NOW} />, { wrapper });
        fireEvent.press(screen.getByLabelText('Unread'));

        expect(screen.getByText('Controller unreachable')).toBeOnTheScreen();
        expect(screen.queryByText('Forecast stale')).toBeNull();
    });

    it('filters to danger-only alerts when the Critical chip is selected.', () => {
        const wrapper = seed([
            buildAlert({ id: 'a-1', title: 'Controller unreachable', tone: 'danger' }),
            buildAlert({ id: 'a-2', title: 'Forecast stale', tone: 'warn', class: 'weather-stale' }),
        ]);

        render(<AlertsView now={NOW} />, { wrapper });
        fireEvent.press(screen.getByLabelText('Critical'));

        expect(screen.getByText('Controller unreachable')).toBeOnTheScreen();
        expect(screen.queryByText('Forecast stale')).toBeNull();
    });

    it('shows the no-match line when a filter empties the list.', () => {
        const wrapper = seed([
            buildAlert({ id: 'a-1', title: 'Forecast stale', tone: 'warn', class: 'weather-stale', ack: true }),
        ]);

        render(<AlertsView now={NOW} />, { wrapper });
        fireEvent.press(screen.getByLabelText('Unread'));

        expect(screen.getByText('No alerts match this filter.')).toBeOnTheScreen();
    });

    it('shows the empty state when there are no alerts at all.', () => {
        const wrapper = seed([]);

        render(<AlertsView now={NOW} />, { wrapper });

        expect(screen.getByText('Nothing to flag')).toBeOnTheScreen();
        expect(screen.getByText('No active alerts')).toBeOnTheScreen();
    });

    it('groups alerts by recency under the right headers.', () => {
        const wrapper = seed([
            buildAlert({ id: 'fresh', title: 'Controller unreachable', when: '2026-05-29T20:02:00.000Z' }), // new
            buildAlert({ id: 'earlier', title: 'Cycle cut short', when: '2026-05-29T08:41:00.000Z', tone: 'warn', class: 'missed-close' }), // today
        ]);

        render(<AlertsView now={NOW} />, { wrapper });

        expect(screen.getByText('New')).toBeOnTheScreen();
        expect(screen.getByText('Earlier today')).toBeOnTheScreen();
        expect(screen.getByText('Controller unreachable')).toBeOnTheScreen();
        expect(screen.getByText('Cycle cut short')).toBeOnTheScreen();
    });

    it('fans out an ack request per unread alert on Mark all read.', async () => {
        const wrapper = seed([
            buildAlert({ id: 'a-1', ack: false }),
            buildAlert({ id: 'a-2', ack: false, title: 'Forecast stale', tone: 'warn', class: 'weather-stale' }),
            buildAlert({ id: 'a-3', ack: true, title: 'Old news' }),
        ]);

        render(<AlertsView now={NOW} />, { wrapper });
        fireEvent.press(screen.getByLabelText('Mark all read'));

        await waitFor(() => {
            const ackUrls = mockFetch.mock.calls
                .map(([url]) => String(url))
                .filter(url => url.includes('/ack'));
            expect(ackUrls).toContain('http://test.local:9753/alerts/a-1/ack');
            expect(ackUrls).toContain('http://test.local:9753/alerts/a-2/ack');
            expect(ackUrls).not.toContain('http://test.local:9753/alerts/a-3/ack');
        });
    });

    it('marks the Mark all read label pointer-transparent so taps reach the button (APP-81).', () => {
        // Regression guard: the old hand-rolled Pressable wrapped a bare Text
        // that swallowed the touch on a real device, so onPress never fired.
        // The Button primitive declares pointerEvents='none' on its label.
        const wrapper = seed([buildAlert({ id: 'a-1', ack: false })]);

        render(<AlertsView now={NOW} />, { wrapper });

        expect(screen.getByText('Mark all read').props.pointerEvents).toBe('none');
    });

    it('clears the list to the empty state after Mark all read (APP-81).', async () => {
        // The server drops acked alerts from GET /alerts, so a successful
        // ack-all should refetch to the empty list and render "Nothing to flag".
        mockFetch.mockImplementation((input: unknown) => {
            const url = String(input);
            if (url.includes('/ack')) {
                currentAlerts = [];
                return Promise.resolve(jsonResponse({ status: 'acked' }));
            }
            if (url.endsWith('/alerts')) return Promise.resolve(jsonResponse({ alerts: currentAlerts }));
            return Promise.resolve(jsonResponse({}));
        });
        const wrapper = seed([
            buildAlert({ id: 'a-1', ack: false }),
            buildAlert({ id: 'a-2', ack: false, title: 'Forecast stale', tone: 'warn', class: 'weather-stale' }),
        ]);

        render(<AlertsView now={NOW} />, { wrapper });
        fireEvent.press(screen.getByLabelText('Mark all read'));

        await waitFor(() => {
            expect(screen.getByText('Nothing to flag')).toBeOnTheScreen();
        });
    });

    it('disables Mark all read when there are no unread alerts.', () => {
        const wrapper = seed([
            buildAlert({ id: 'a-1', ack: true }),
        ]);

        render(<AlertsView now={NOW} />, { wrapper });
        fireEvent.press(screen.getByLabelText('Mark all read'));

        const ackUrls = mockFetch.mock.calls.map(([url]) => String(url)).filter(url => url.includes('/ack'));
        expect(ackUrls).toHaveLength(0);
        expect(screen.getByLabelText('Mark all read').props.accessibilityState).toMatchObject({ disabled: true });
    });

    it('renders "Mark all read" alongside the Recent alerts heading (APP-82).', () => {
        const wrapper = seed([buildAlert({ id: 'a-1', ack: false })]);

        render(<AlertsView now={NOW} />, { wrapper });

        // The header row (with the old "Alerts" title + back button) is gone;
        // "Mark all read" now lives with the page heading.
        expect(screen.getByText('Recent alerts')).toBeOnTheScreen();
        expect(screen.getByLabelText('Mark all read')).toBeOnTheScreen();
        expect(screen.queryByLabelText('Back')).toBeNull();
    });

    it('hides "Mark all read" in the empty state — there are no alerts to act on (APP-82).', () => {
        const wrapper = seed([]);

        render(<AlertsView now={NOW} />, { wrapper });

        expect(screen.getByText('Nothing to flag')).toBeOnTheScreen();
        expect(screen.queryByLabelText('Mark all read')).toBeNull();
    });
});
