import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { buildApiWrapper, jsonResponse } from '@/api/test-utils';
import { keys } from '@/api/query-keys';
import type { NotificationSettingsDto } from '@/api/types/settings';
import { NotificationSettingsView } from '.';

const mockFetch = jest.fn();

const DTO: NotificationSettingsDto = {
    scheduleStart: true,
    scheduleEnd: true,
    wateringStart: false,
    wateringEnd: false,
    error: true,
};

beforeEach(() => {
    (global as { fetch: typeof fetch }).fetch = mockFetch as unknown as typeof fetch;
    mockFetch.mockReset();
    process.env.EXPO_PUBLIC_API_BASE_URL = 'http://test.local:9753';
});

describe('NotificationSettingsView', () => {
    it('renders the five notification toggles reflecting the fetched values.', async () => {
        const { wrapper, client } = buildApiWrapper();
        client.setQueryData(keys.settings.notifications(), DTO);

        render(<NotificationSettingsView />, { wrapper });

        expect(screen.getByText('Settings')).toBeOnTheScreen();
        // The on flags (schedule start/end + error) report checked; the off
        // flags (watering start/end) report unchecked.
        expect(screen.getByLabelText('Schedule started').props.accessibilityState).toMatchObject({ checked: true });
        expect(screen.getByLabelText('Schedule ended').props.accessibilityState).toMatchObject({ checked: true });
        expect(screen.getByLabelText('Errors').props.accessibilityState).toMatchObject({ checked: true });
        expect(screen.getByLabelText('Watering started').props.accessibilityState).toMatchObject({ checked: false });
        expect(screen.getByLabelText('Watering ended').props.accessibilityState).toMatchObject({ checked: false });
    });

    it('PATCHes the tapped flag and flips it optimistically.', async () => {
        // PATCH never resolves so the optimistic flip is the only state change.
        mockFetch.mockImplementation(() => new Promise(() => {}));

        const { wrapper, client } = buildApiWrapper();
        client.setQueryData(keys.settings.notifications(), DTO);

        render(<NotificationSettingsView />, { wrapper });

        fireEvent.press(screen.getByLabelText('Watering started'));

        // The PATCH carries only the tapped field (the on-mount GET has no
        // body, so only consider calls that actually sent one).
        await waitFor(() => {
            const bodies = mockFetch.mock.calls
                .map(([, init]) => (init as RequestInit | undefined)?.body)
                .filter((body): body is string => typeof body === 'string')
                .map(body => JSON.parse(body));
            expect(bodies).toContainEqual({ wateringStart: true });
        });
        // …and the toggle flips on instantly via the optimistic cache write.
        await waitFor(() =>
            expect(screen.getByLabelText('Watering started').props.accessibilityState).toMatchObject({ checked: true }),
        );
    });

    it('shows a loading placeholder while the settings query is pending.', () => {
        // Fetch never resolves → the query stays pending.
        mockFetch.mockImplementation(() => new Promise(() => {}));

        render(<NotificationSettingsView />, { wrapper: buildApiWrapper().wrapper });

        expect(screen.getByText('Fetching notification settings…')).toBeOnTheScreen();
    });

    it('shows an error message when the settings query fails.', async () => {
        mockFetch.mockResolvedValue(jsonResponse({ error: 'boom' }, 500));

        render(<NotificationSettingsView />, { wrapper: buildApiWrapper().wrapper });

        await waitFor(() =>
            expect(screen.getByText('Failed to load notification settings.')).toBeOnTheScreen(),
        );
    });
});
