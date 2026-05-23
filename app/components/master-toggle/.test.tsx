import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { buildApiWrapper, jsonResponse } from '@/api/test-utils';

import { MasterToggle } from '.';

const mockFetch = jest.fn();

const SAMPLE_TIMESTAMP = '2026-05-22T00:00:00.000Z';

beforeEach(() => {
    (global as { fetch: typeof fetch }).fetch = mockFetch as unknown as typeof fetch;
    mockFetch.mockReset();
    process.env.EXPO_PUBLIC_API_BASE_URL = 'http://test.local:9753';
});

describe('MasterToggle', () => {
    it('renders the loading card while the initial query is pending.', async () => {
        // Pending forever so we observe the loading branch.
        mockFetch.mockImplementation(() => new Promise(() => {}));

        render(<MasterToggle />, { wrapper: buildApiWrapper().wrapper });

        expect(screen.getByText('Loading')).toBeOnTheScreen();
        expect(screen.getByText('Fetching irrigation status…')).toBeOnTheScreen();
    });

    it('renders the ON card after a successful system query (irrigation enabled).', async () => {
        mockFetch.mockResolvedValueOnce(jsonResponse({ irrigationEnabled: true, since: SAMPLE_TIMESTAMP }));

        render(<MasterToggle />, { wrapper: buildApiWrapper().wrapper });

        await waitFor(() => expect(screen.getByText('System on')).toBeOnTheScreen());
        expect(screen.getByText('Irrigation enabled')).toBeOnTheScreen();
        expect(screen.getByText('Scheduling & manual runs allowed')).toBeOnTheScreen();
        expect(screen.getByLabelText('Disable irrigation')).toBeOnTheScreen();
    });

    it('renders the OFF card after a successful system query (irrigation disabled).', async () => {
        mockFetch.mockResolvedValueOnce(jsonResponse({ irrigationEnabled: false, since: SAMPLE_TIMESTAMP }));

        render(<MasterToggle />, { wrapper: buildApiWrapper().wrapper });

        await waitFor(() => expect(screen.getByText('System off')).toBeOnTheScreen());
        expect(screen.getByText('Irrigation disabled')).toBeOnTheScreen();
        expect(screen.getByText('Master kill switch · all runs blocked')).toBeOnTheScreen();
        expect(screen.getByLabelText('Enable irrigation')).toBeOnTheScreen();
    });

    it('POSTs /system/disable when the toggle is flipped from on to off.', async () => {
        // Sequence: GET /system, POST /system/disable, GET /system (re-fetch
        // after the mutation's onSuccess invalidates the system query).
        mockFetch.mockResolvedValue(jsonResponse({ irrigationEnabled: true, since: SAMPLE_TIMESTAMP }));
        mockFetch.mockResolvedValueOnce(jsonResponse({ irrigationEnabled: true, since: SAMPLE_TIMESTAMP }));
        mockFetch.mockResolvedValueOnce(jsonResponse({ irrigationEnabled: false, since: SAMPLE_TIMESTAMP }));

        render(<MasterToggle />, { wrapper: buildApiWrapper().wrapper });

        await waitFor(() => expect(screen.getByLabelText('Disable irrigation')).toBeOnTheScreen());

        await act(async () => {
            fireEvent.press(screen.getByLabelText('Disable irrigation'));
        });

        await waitFor(() => {
            const urls = mockFetch.mock.calls.map(call => (call as [string, RequestInit])[0]);
            expect(urls).toContain('http://test.local:9753/system/disable');
        });
    });

    it('POSTs /system/enable when the toggle is flipped from off to on.', async () => {
        mockFetch.mockResolvedValue(jsonResponse({ irrigationEnabled: false, since: SAMPLE_TIMESTAMP }));
        mockFetch.mockResolvedValueOnce(jsonResponse({ irrigationEnabled: false, since: SAMPLE_TIMESTAMP }));
        mockFetch.mockResolvedValueOnce(jsonResponse({ irrigationEnabled: true, since: SAMPLE_TIMESTAMP }));

        render(<MasterToggle />, { wrapper: buildApiWrapper().wrapper });

        await waitFor(() => expect(screen.getByLabelText('Enable irrigation')).toBeOnTheScreen());

        await act(async () => {
            fireEvent.press(screen.getByLabelText('Enable irrigation'));
        });

        await waitFor(() => {
            const urls = mockFetch.mock.calls.map(call => (call as [string, RequestInit])[0]);
            expect(urls).toContain('http://test.local:9753/system/enable');
        });
    });

    it('renders the error card when the initial system query fails.', async () => {
        mockFetch.mockResolvedValueOnce(jsonResponse({ error: 'boom' }, 500));

        render(<MasterToggle />, { wrapper: buildApiWrapper().wrapper });

        await waitFor(() => expect(screen.getByText('System unreachable')).toBeOnTheScreen());
        expect(screen.getByText('Status unknown')).toBeOnTheScreen();
        expect(screen.getByText('Failed to load system state.')).toBeOnTheScreen();
    });

    it('surfaces a mutation error in the sub-line while keeping the last-known tone.', async () => {
        // First call: initial GET returns enabled.
        mockFetch.mockResolvedValueOnce(jsonResponse({ irrigationEnabled: true, since: SAMPLE_TIMESTAMP }));
        // Second call: the disable mutation fails.
        mockFetch.mockResolvedValueOnce(jsonResponse({ error: 'HA 502' }, 502));
        // Any subsequent re-fetch from invalidation: keep returning enabled.
        mockFetch.mockResolvedValue(jsonResponse({ irrigationEnabled: true, since: SAMPLE_TIMESTAMP }));

        render(<MasterToggle />, { wrapper: buildApiWrapper().wrapper });

        await waitFor(() => expect(screen.getByLabelText('Disable irrigation')).toBeOnTheScreen());

        await act(async () => {
            fireEvent.press(screen.getByLabelText('Disable irrigation'));
        });

        // Sub line flips to the error prefix; the card still reads "System on"
        // since the displayed value tracks the query, not the failed mutation.
        await waitFor(() => expect(screen.getByText(/Last attempt failed:/)).toBeOnTheScreen());
        expect(screen.getByText('System on')).toBeOnTheScreen();
    });

    it('renders under the default accessibility label.', async () => {
        mockFetch.mockResolvedValueOnce(jsonResponse({ irrigationEnabled: true, since: SAMPLE_TIMESTAMP }));

        render(<MasterToggle />, { wrapper: buildApiWrapper().wrapper });

        await waitFor(() => expect(screen.getByLabelText('Master irrigation kill switch')).toBeOnTheScreen());
    });

    it('honors a caller-provided accessibility label on the card container.', async () => {
        mockFetch.mockResolvedValueOnce(jsonResponse({ irrigationEnabled: true, since: SAMPLE_TIMESTAMP }));

        render(<MasterToggle accessibilityLabel='Main switch' />, { wrapper: buildApiWrapper().wrapper });

        await waitFor(() => expect(screen.getByLabelText('Main switch')).toBeOnTheScreen());
    });
});
