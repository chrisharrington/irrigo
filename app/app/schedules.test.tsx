import { render, screen, waitFor } from '@testing-library/react-native';

import { buildApiWrapper, jsonResponse } from '@/api/test-utils';
import type { ScheduleListItem } from '@/api/types/schedules';

jest.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 24, bottom: 0, left: 0, right: 0 }),
}));

import SchedulesScreen from './schedules';

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

const ALL_SCHEDULES = [ACTIVE_SCHEDULE, WEEKEND_SCHEDULE];

const mockFetch = jest.fn();

beforeEach(() => {
    (global as { fetch: typeof fetch }).fetch = mockFetch as unknown as typeof fetch;
    mockFetch.mockReset();
    process.env.EXPO_PUBLIC_API_BASE_URL = 'http://test.local:9753';
});

describe('SchedulesScreen route', () => {
    it('resolves the /schedules route and renders the Schedules screen body.', async () => {
        mockFetch.mockResolvedValue(jsonResponse(ALL_SCHEDULES));

        render(<SchedulesScreen />, { wrapper: buildApiWrapper().wrapper });

        // The route renders the real ScheduleListView (not a dead-end): the
        // screen title and the active schedule's name both appear.
        expect(screen.getByText('Schedules')).toBeOnTheScreen();
        await waitFor(() => expect(screen.getByText('Maintenance')).toBeOnTheScreen());
    });

    it('fetches the schedules list from /schedules when the route mounts.', async () => {
        mockFetch.mockResolvedValue(jsonResponse(ALL_SCHEDULES));

        render(<SchedulesScreen />, { wrapper: buildApiWrapper().wrapper });

        await waitFor(() => {
            const urls = mockFetch.mock.calls.map(([url]) => String(url));
            expect(urls).toContain('http://test.local:9753/schedules');
        });
    });
});
