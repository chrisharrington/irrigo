import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';

import { buildApiWrapper, jsonResponse } from '@/api/test-utils';

const mockHideAsync = jest.fn(() => Promise.resolve());

jest.mock('expo-splash-screen', () => ({
    preventAutoHideAsync: jest.fn(() => Promise.resolve()),
    hideAsync: () => mockHideAsync(),
}));

import { ReachabilityGate } from '.';

const mockFetch = jest.fn();

beforeEach(() => {
    (global as { fetch: typeof fetch }).fetch = mockFetch as unknown as typeof fetch;
    mockFetch.mockReset();
    mockHideAsync.mockClear();
    process.env.EXPO_PUBLIC_API_BASE_URL = 'http://test.local:9753';
});

describe('ReachabilityGate', () => {
    it('renders nothing while the probe is still pending so the splash stays up.', () => {
        // Never-resolving fetch keeps useHealth in its pending state.
        mockFetch.mockImplementation(() => new Promise(() => {}));
        const { wrapper } = buildApiWrapper();

        render(
            <ReachabilityGate>
                <Text>home-marker</Text>
            </ReachabilityGate>,
            { wrapper },
        );

        expect(screen.queryByText('home-marker')).toBeNull();
        expect(screen.queryByText('Connection lost')).toBeNull();
    });

    it('renders the children once the probe succeeds.', async () => {
        mockFetch.mockResolvedValueOnce(jsonResponse({ ok: true }));
        const { wrapper } = buildApiWrapper();

        render(
            <ReachabilityGate>
                <Text>home-marker</Text>
            </ReachabilityGate>,
            { wrapper },
        );

        await waitFor(() => expect(screen.getByText('home-marker')).toBeOnTheScreen());
    });

    it(`shows the "Can't reach the Irrigo service" headline on a transport failure.`, async () => {
        mockFetch.mockRejectedValueOnce(new TypeError('Network request failed'));
        const { wrapper } = buildApiWrapper();

        render(
            <ReachabilityGate>
                <Text>home-marker</Text>
            </ReachabilityGate>,
            { wrapper },
        );

        await waitFor(() => expect(screen.getByText(`Can't reach the Irrigo service`)).toBeOnTheScreen());
        expect(screen.queryByText('home-marker')).toBeNull();
    });

    it('shows the "Service is unhealthy" headline on a 5xx response.', async () => {
        mockFetch.mockResolvedValueOnce(jsonResponse({ error: 'planner' }, 503));
        const { wrapper } = buildApiWrapper();

        render(
            <ReachabilityGate>
                <Text>home-marker</Text>
            </ReachabilityGate>,
            { wrapper },
        );

        await waitFor(() => expect(screen.getByText('Service is unhealthy')).toBeOnTheScreen());
    });

    it('surfaces the resolved EXPO_PUBLIC_API_BASE_URL in the ErrorView sub-line.', async () => {
        process.env.EXPO_PUBLIC_API_BASE_URL = 'http://my.lan.host:9753';
        mockFetch.mockRejectedValueOnce(new TypeError('Network request failed'));
        const { wrapper } = buildApiWrapper();

        render(
            <ReachabilityGate>
                <Text>home-marker</Text>
            </ReachabilityGate>,
            { wrapper },
        );

        await waitFor(() => expect(screen.getByText('Tried http://my.lan.host:9753.')).toBeOnTheScreen());
    });

    it('renders ErrorView in the idle state once the failed probe has settled.', async () => {
        mockFetch.mockRejectedValueOnce(new TypeError('Network request failed'));
        const { wrapper } = buildApiWrapper();

        render(
            <ReachabilityGate>
                <Text>home-marker</Text>
            </ReachabilityGate>,
            { wrapper },
        );

        await waitFor(() => expect(screen.getByText('Retry connection')).toBeOnTheScreen());
        expect(screen.queryByText('Cancel attempt')).toBeNull();
    });

    it('re-runs the probe when the retry button is pressed.', async () => {
        // First call fails; second resolves so React Query settles cleanly.
        mockFetch.mockRejectedValueOnce(new TypeError('Network request failed'));
        mockFetch.mockResolvedValueOnce(jsonResponse({ ok: true }));
        const { wrapper } = buildApiWrapper();

        render(
            <ReachabilityGate>
                <Text>home-marker</Text>
            </ReachabilityGate>,
            { wrapper },
        );

        await waitFor(() => expect(screen.getByText('Retry connection')).toBeOnTheScreen());

        fireEvent.press(screen.getByText('Retry connection'));

        await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
        // Once the second probe resolves, the gate flips to the children.
        await waitFor(() => expect(screen.getByText('home-marker')).toBeOnTheScreen());
    });

    it('drops the native splash exactly once when the probe settles into the error state.', async () => {
        mockFetch.mockRejectedValueOnce(new TypeError('Network request failed'));
        const { wrapper } = buildApiWrapper();

        render(
            <ReachabilityGate>
                <Text>home-marker</Text>
            </ReachabilityGate>,
            { wrapper },
        );

        await waitFor(() => expect(mockHideAsync).toHaveBeenCalledTimes(1));
    });

    it('drops the native splash exactly once when the probe settles into the success state.', async () => {
        mockFetch.mockResolvedValueOnce(jsonResponse({ ok: true }));
        const { wrapper } = buildApiWrapper();

        render(
            <ReachabilityGate>
                <Text>home-marker</Text>
            </ReachabilityGate>,
            { wrapper },
        );

        await waitFor(() => expect(mockHideAsync).toHaveBeenCalledTimes(1));
    });
});
