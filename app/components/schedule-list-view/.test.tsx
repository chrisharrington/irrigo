import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';

import { buildApiWrapper, jsonResponse } from '@/api/test-utils';
import type { ScheduleListItem } from '@/api/types/schedules';

import { ScheduleListView } from '.';

const mockFetch = jest.fn();

const ACTIVE_SCHEDULE: ScheduleListItem = {
    id: 'sched-active',
    slug: 'maintenance',
    name: 'Maintenance',
    isActive: true,
    allowedDays: [1, 3, 5],
    allowedTimeWindows: [{ start: '22:00', end: '06:00' }],
    rootDepthMOverride: 0.18,
    allowableDepletionFractionOverride: 0.5,
    endBySunrise: true,
    nextRun: { inLabel: '4h 32m', whenLabel: 'tonight at 10:23pm', zonesLabel: 'North + East' },
    skippedTonight: false,
};

const WEEKEND_SCHEDULE: ScheduleListItem = {
    id: 'sched-weekend',
    slug: 'weekend',
    name: 'Weekend',
    isActive: false,
    allowedDays: [6, 7],
    allowedTimeWindows: [{ start: '20:00', end: '04:00' }],
    rootDepthMOverride: null,
    allowableDepletionFractionOverride: null,
    endBySunrise: null,
};

const OVERSEEDING_SCHEDULE: ScheduleListItem = {
    id: 'sched-overseed',
    slug: 'overseeding',
    name: 'Overseeding',
    isActive: false,
    allowedDays: null,
    allowedTimeWindows: null,
    rootDepthMOverride: 0.08,
    allowableDepletionFractionOverride: 0.3,
    endBySunrise: false,
};

const ALL_SCHEDULES = [ACTIVE_SCHEDULE, WEEKEND_SCHEDULE, OVERSEEDING_SCHEDULE];

beforeEach(() => {
    (global as { fetch: typeof fetch }).fetch = mockFetch as unknown as typeof fetch;
    mockFetch.mockReset();
    process.env.EXPO_PUBLIC_API_BASE_URL = 'http://test.local:9753';
});

describe('ScheduleListView', () => {
    it('renders the loading state while the schedules query is pending.', () => {
        mockFetch.mockImplementation(() => new Promise(() => {}));

        render(<ScheduleListView />, { wrapper: buildApiWrapper().wrapper });

        expect(screen.getByText('Profile · loading')).toBeOnTheScreen();
        expect(screen.getByText('Fetching schedules…')).toBeOnTheScreen();
    });

    it('renders the error state when the schedules query fails.', async () => {
        mockFetch.mockResolvedValueOnce(jsonResponse({ error: 'boom' }, 500));

        render(<ScheduleListView />, { wrapper: buildApiWrapper().wrapper });

        await waitFor(() => expect(screen.getByText('Failed to load schedules.')).toBeOnTheScreen());
        expect(screen.getByText('Profile · unavailable')).toBeOnTheScreen();
    });

    it('renders the active schedule in the hero and the rest as rows.', async () => {
        mockFetch.mockResolvedValueOnce(jsonResponse(ALL_SCHEDULES));

        render(<ScheduleListView />, { wrapper: buildApiWrapper().wrapper });

        await waitFor(() => expect(screen.getByText('Maintenance')).toBeOnTheScreen());
        expect(screen.getByText('Profile · 1 active')).toBeOnTheScreen();
        expect(screen.getByLabelText('Switch to Weekend')).toBeOnTheScreen();
        expect(screen.getByLabelText('Switch to Overseeding')).toBeOnTheScreen();
    });

    it('opens the switch modal when a non-active row is pressed.', async () => {
        mockFetch.mockResolvedValueOnce(jsonResponse(ALL_SCHEDULES));

        render(<ScheduleListView />, { wrapper: buildApiWrapper().wrapper });

        await waitFor(() => expect(screen.getByText('Maintenance')).toBeOnTheScreen());

        fireEvent.press(screen.getByLabelText('Switch to Weekend'));

        await waitFor(() => expect(screen.getByText('Switch to Weekend?')).toBeOnTheScreen());
    });

    it('closes the modal on cancel without calling the enable endpoint.', async () => {
        mockFetch.mockResolvedValueOnce(jsonResponse(ALL_SCHEDULES));

        render(<ScheduleListView />, { wrapper: buildApiWrapper().wrapper });

        await waitFor(() => expect(screen.getByText('Maintenance')).toBeOnTheScreen());

        fireEvent.press(screen.getByLabelText('Switch to Weekend'));
        await waitFor(() => expect(screen.getByText('Switch to Weekend?')).toBeOnTheScreen());

        fireEvent.press(screen.getByText('Cancel'));

        await waitFor(() => expect(screen.queryByText('Switch to Weekend?')).toBeNull());

        // Only the initial GET was called — no POST.
        const postCalls = mockFetch.mock.calls.filter(call => {
            const [, init] = call as [string, RequestInit];
            return init.method === 'POST';
        });
        expect(postCalls).toHaveLength(0);
    });

    it('POSTs /schedule/{slug}/enable when the modal Switch & re-plan button is pressed.', async () => {
        mockFetch.mockResolvedValueOnce(jsonResponse(ALL_SCHEDULES));
        mockFetch.mockResolvedValueOnce(jsonResponse({ status: 'enabled', schedule: { slug: 'weekend', name: 'Weekend', siteId: 'site-1' } }));
        // Refetch after invalidation.
        mockFetch.mockResolvedValue(jsonResponse(ALL_SCHEDULES));

        render(<ScheduleListView />, { wrapper: buildApiWrapper().wrapper });

        await waitFor(() => expect(screen.getByText('Maintenance')).toBeOnTheScreen());

        fireEvent.press(screen.getByLabelText('Switch to Weekend'));
        await waitFor(() => expect(screen.getByText('Switch to Weekend?')).toBeOnTheScreen());

        await act(async () => {
            fireEvent.press(screen.getByText('Switch & re-plan'));
        });

        await waitFor(() => {
            const urls = mockFetch.mock.calls.map(call => (call as [string, RequestInit])[0]);
            expect(urls).toContain('http://test.local:9753/schedule/enable/weekend');
        });
    });

    it('POSTs /schedule/skip-tonight when the Skip tonight button is pressed.', async () => {
        mockFetch.mockResolvedValueOnce(jsonResponse(ALL_SCHEDULES));
        mockFetch.mockResolvedValueOnce(jsonResponse({ status: 'skipped', schedule: { slug: 'maintenance', name: 'Maintenance', siteId: 'site-1' } }));
        mockFetch.mockResolvedValue(jsonResponse(ALL_SCHEDULES));

        render(<ScheduleListView />, { wrapper: buildApiWrapper().wrapper });

        await waitFor(() => expect(screen.getByText('Maintenance')).toBeOnTheScreen());

        await act(async () => {
            fireEvent.press(screen.getByText('Skip tonight'));
        });

        await waitFor(() => {
            const urls = mockFetch.mock.calls.map(call => (call as [string, RequestInit])[0]);
            expect(urls).toContain('http://test.local:9753/schedule/skip-tonight');
        });
    });

    it('POSTs /schedule/resume-tonight when Resume tonight is pressed (active schedule already skipping).', async () => {
        const skippingActive = { ...ACTIVE_SCHEDULE, skippedTonight: true };
        mockFetch.mockResolvedValueOnce(jsonResponse([skippingActive, WEEKEND_SCHEDULE, OVERSEEDING_SCHEDULE]));
        mockFetch.mockResolvedValueOnce(jsonResponse({ status: 'resumed', schedule: { slug: 'maintenance', name: 'Maintenance', siteId: 'site-1' } }));
        mockFetch.mockResolvedValue(jsonResponse([skippingActive, WEEKEND_SCHEDULE, OVERSEEDING_SCHEDULE]));

        render(<ScheduleListView />, { wrapper: buildApiWrapper().wrapper });

        await waitFor(() => expect(screen.getByText('Resume tonight')).toBeOnTheScreen());

        await act(async () => {
            fireEvent.press(screen.getByText('Resume tonight'));
        });

        await waitFor(() => {
            const urls = mockFetch.mock.calls.map(call => (call as [string, RequestInit])[0]);
            expect(urls).toContain('http://test.local:9753/schedule/resume-tonight');
        });
    });

    it('POSTs /replan when the re-plan icon button is pressed.', async () => {
        mockFetch.mockResolvedValueOnce(jsonResponse(ALL_SCHEDULES));
        mockFetch.mockResolvedValueOnce(jsonResponse({ ok: true }));
        mockFetch.mockResolvedValue(jsonResponse(ALL_SCHEDULES));

        render(<ScheduleListView />, { wrapper: buildApiWrapper().wrapper });

        await waitFor(() => expect(screen.getByText('Maintenance')).toBeOnTheScreen());

        await act(async () => {
            fireEvent.press(screen.getByLabelText('Re-plan now'));
        });

        await waitFor(() => {
            const urls = mockFetch.mock.calls.map(call => (call as [string, RequestInit])[0]);
            expect(urls).toContain('http://test.local:9753/replan');
        });
    });

    it('handles an empty schedule list without crashing — no hero, no rows, eyebrow flips to none active.', async () => {
        mockFetch.mockResolvedValueOnce(jsonResponse([]));

        render(<ScheduleListView />, { wrapper: buildApiWrapper().wrapper });

        await waitFor(() => expect(screen.getByText('Profile · none active')).toBeOnTheScreen());
        expect(screen.queryByText('Maintenance')).toBeNull();
        expect(screen.getByText('Other profiles')).toBeOnTheScreen();
    });

    it('renders the disabled "+ New" stub button.', async () => {
        mockFetch.mockResolvedValueOnce(jsonResponse(ALL_SCHEDULES));

        const { root } = render(<ScheduleListView />, { wrapper: buildApiWrapper().wrapper });

        await waitFor(() => expect(screen.getByText('Other profiles')).toBeOnTheScreen());
        const newButton = findByAccessibilityLabel(root, 'Add new profile');
        expect(newButton?.props.accessibilityState).toEqual({ disabled: true });
    });
});

function findByAccessibilityLabel(root: ReactTestInstance, label: string): ReactTestInstance | undefined {
    return root.find(node => typeof node.type === 'string' && node.props.accessibilityLabel === label);
}
