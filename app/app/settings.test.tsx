import { render, screen, waitFor } from '@testing-library/react-native';

import { buildApiWrapper, jsonResponse } from '@/api/test-utils';
import type { NotificationSettingsDto } from '@/api/types/settings';

jest.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 24, bottom: 0, left: 0, right: 0 }),
}));

import SettingsScreen from './settings';

const DTO: NotificationSettingsDto = {
    scheduleStart: true,
    scheduleEnd: true,
    wateringStart: false,
    wateringEnd: false,
    error: true,
};

const mockFetch = jest.fn();

beforeEach(() => {
    (global as { fetch: typeof fetch }).fetch = mockFetch as unknown as typeof fetch;
    mockFetch.mockReset();
    process.env.EXPO_PUBLIC_API_BASE_URL = 'http://test.local:9753';
});

describe('SettingsScreen route', () => {
    it('resolves the /settings route and renders the Settings screen body.', async () => {
        mockFetch.mockResolvedValue(jsonResponse(DTO));

        render(<SettingsScreen />, { wrapper: buildApiWrapper().wrapper });

        // The route renders the real NotificationSettingsView (not a dead-end):
        // the screen title and a toggle row both appear.
        expect(screen.getByText('Settings')).toBeOnTheScreen();
        await waitFor(() => expect(screen.getByLabelText('Schedule started')).toBeOnTheScreen());
    });

    it('fetches the notification settings from /settings/notifications when the route mounts.', async () => {
        mockFetch.mockResolvedValue(jsonResponse(DTO));

        render(<SettingsScreen />, { wrapper: buildApiWrapper().wrapper });

        await waitFor(() => {
            const urls = mockFetch.mock.calls.map(([url]) => String(url));
            expect(urls).toContain('http://test.local:9753/settings/notifications');
        });
    });
});
