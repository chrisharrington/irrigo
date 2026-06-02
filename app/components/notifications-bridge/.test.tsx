import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

jest.mock('expo-notifications', () => ({
    getPermissionsAsync: jest.fn(),
    requestPermissionsAsync: jest.fn(),
    getExpoPushTokenAsync: jest.fn(),
    setNotificationHandler: jest.fn(),
    addNotificationReceivedListener: jest.fn(),
    addNotificationResponseReceivedListener: jest.fn(),
    PermissionStatus: { UNDETERMINED: 'undetermined', GRANTED: 'granted', DENIED: 'denied' },
}));

jest.mock('expo-constants', () => ({
    __esModule: true,
    default: {
        expoConfig: { extra: { eas: { projectId: 'test-project-id' } } },
        easConfig: undefined,
    },
}));

jest.mock('expo-device', () => ({
    modelName: 'Pixel Test',
    osName: 'Android',
    osVersion: '14',
}));

jest.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 44, bottom: 0, left: 0, right: 0 }),
}));

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
    useRouter: () => ({ push: mockPush }),
}));

import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { buildApiWrapper, jsonResponse } from '@/api/test-utils';

import { NotificationsBridge } from '.';

const getPermissionsAsync = Notifications.getPermissionsAsync as jest.Mock;
const requestPermissionsAsync = Notifications.requestPermissionsAsync as jest.Mock;
const getExpoPushTokenAsync = Notifications.getExpoPushTokenAsync as jest.Mock;
const addNotificationReceivedListener = Notifications.addNotificationReceivedListener as jest.Mock;
const addNotificationResponseReceivedListener = Notifications.addNotificationResponseReceivedListener as jest.Mock;

const mockFetch = jest.fn();

function buildPermission(overrides: { granted?: boolean; status?: string; canAskAgain?: boolean } = {}) {
    return {
        status: overrides.status ?? 'granted',
        granted: overrides.granted ?? true,
        canAskAgain: overrides.canAskAgain ?? true,
        expires: 'never',
    };
}

beforeEach(() => {
    (global as { fetch: typeof fetch }).fetch = mockFetch as unknown as typeof fetch;
    mockFetch.mockReset();
    mockPush.mockReset();
    getPermissionsAsync.mockReset();
    requestPermissionsAsync.mockReset();
    getExpoPushTokenAsync.mockReset();
    addNotificationReceivedListener.mockReset();
    addNotificationResponseReceivedListener.mockReset();
    addNotificationReceivedListener.mockReturnValue({ remove: jest.fn() });
    addNotificationResponseReceivedListener.mockReturnValue({ remove: jest.fn() });
    process.env.EXPO_PUBLIC_API_BASE_URL = 'http://test.local:9753';
});

describe('NotificationsBridge', () => {
    it('POSTs the push token to /push/register once permission is granted and a token resolves.', async () => {
        getPermissionsAsync.mockResolvedValueOnce(buildPermission({ granted: true, status: 'granted' }));
        getExpoPushTokenAsync.mockResolvedValueOnce({ data: 'ExponentPushToken[xyz]', type: 'expo' });
        mockFetch.mockResolvedValue(jsonResponse({ status: 'registered' }));

        render(<NotificationsBridge />, { wrapper: buildApiWrapper().wrapper });

        await waitFor(() => {
            const calls = mockFetch.mock.calls.map(call => (call as [string, RequestInit])[0]);
            expect(calls).toContain('http://test.local:9753/push/register');
        });

        const registerCall = mockFetch.mock.calls.find(call => (call as [string, RequestInit])[0] === 'http://test.local:9753/push/register');
        const body = JSON.parse((registerCall as [string, RequestInit])[1].body as string);
        expect(body.token).toBe('ExponentPushToken[xyz]');
        expect(body.platform).toBe(Platform.OS);
        expect(typeof body.userAgent).toBe('string');
    });

    it('does NOT POST to /push/register when permission is denied.', async () => {
        getPermissionsAsync.mockResolvedValueOnce(buildPermission({
            granted: false,
            status: 'denied',
            canAskAgain: false,
        }));

        render(<NotificationsBridge />, { wrapper: buildApiWrapper().wrapper });

        // Give the permission effect time to resolve.
        await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
        });

        const postCalls = mockFetch.mock.calls.filter(call => {
            const [, init] = call as [string, RequestInit];
            return init?.method === 'POST';
        });
        expect(postCalls).toHaveLength(0);
        expect(getExpoPushTokenAsync).not.toHaveBeenCalled();
    });

    it('opens the foreground banner with the title/sub when a notification arrives.', async () => {
        getPermissionsAsync.mockResolvedValueOnce(buildPermission({ granted: true, status: 'granted' }));
        getExpoPushTokenAsync.mockResolvedValueOnce({ data: 'ExponentPushToken[xyz]', type: 'expo' });
        mockFetch.mockResolvedValue(jsonResponse({ status: 'registered' }));

        let receivedHandler: ((event: unknown) => void) | undefined;
        addNotificationReceivedListener.mockImplementation((handler: (event: unknown) => void) => {
            receivedHandler = handler;
            return { remove: jest.fn() };
        });

        render(<NotificationsBridge />, { wrapper: buildApiWrapper().wrapper });

        await waitFor(() => expect(receivedHandler).toBeDefined());

        act(() => {
            receivedHandler?.({
                request: {
                    content: {
                        title: 'HA close failed',
                        body: 'Last attempt failed: 502 Bad Gateway.',
                        data: { tone: 'danger', zoneId: 'zone-001' },
                    },
                },
            });
        });

        expect(screen.getByText('HA close failed')).toBeOnTheScreen();
        expect(screen.getByText('Last attempt failed: 502 Bad Gateway.')).toBeOnTheScreen();
    });

    it('routes via router.push to the zone when a background tap response carries a zoneId.', async () => {
        getPermissionsAsync.mockResolvedValueOnce(buildPermission({ granted: true, status: 'granted' }));
        getExpoPushTokenAsync.mockResolvedValueOnce({ data: 'ExponentPushToken[xyz]', type: 'expo' });
        mockFetch.mockResolvedValue(jsonResponse({ status: 'registered' }));

        let responseHandler: ((event: unknown) => void) | undefined;
        addNotificationResponseReceivedListener.mockImplementation((handler: (event: unknown) => void) => {
            responseHandler = handler;
            return { remove: jest.fn() };
        });

        render(<NotificationsBridge />, { wrapper: buildApiWrapper().wrapper });

        await waitFor(() => expect(responseHandler).toBeDefined());

        act(() => {
            responseHandler?.({
                notification: {
                    request: {
                        content: {
                            data: { zoneId: 'zone-007', alertId: 'alert-1' },
                        },
                    },
                },
            });
        });

        expect(mockPush).toHaveBeenCalledWith('/zone/zone-007');
    });

    it('does not route when a background tap response has no zoneId.', async () => {
        getPermissionsAsync.mockResolvedValueOnce(buildPermission({ granted: true, status: 'granted' }));
        getExpoPushTokenAsync.mockResolvedValueOnce({ data: 'ExponentPushToken[xyz]', type: 'expo' });
        mockFetch.mockResolvedValue(jsonResponse({ status: 'registered' }));

        let responseHandler: ((event: unknown) => void) | undefined;
        addNotificationResponseReceivedListener.mockImplementation((handler: (event: unknown) => void) => {
            responseHandler = handler;
            return { remove: jest.fn() };
        });

        render(<NotificationsBridge />, { wrapper: buildApiWrapper().wrapper });

        await waitFor(() => expect(responseHandler).toBeDefined());

        act(() => {
            responseHandler?.({
                notification: {
                    request: {
                        content: { data: { alertId: 'alert-only' } },
                    },
                },
            });
        });

        expect(mockPush).not.toHaveBeenCalled();
    });

    // --- Lifecycle pushes (APP-103): data.category, no alertId. ---

    /**
     * Renders the bridge and returns a function that fires a background-tap
     * response with the given `data` payload through the captured handler.
     */
    async function captureResponseHandler(): Promise<(data: Record<string, unknown>) => void> {
        getPermissionsAsync.mockResolvedValueOnce(buildPermission({ granted: true, status: 'granted' }));
        getExpoPushTokenAsync.mockResolvedValueOnce({ data: 'ExponentPushToken[xyz]', type: 'expo' });
        mockFetch.mockResolvedValue(jsonResponse({ status: 'registered' }));

        let handler: ((event: unknown) => void) | undefined;
        addNotificationResponseReceivedListener.mockImplementation((h: (event: unknown) => void) => {
            handler = h;
            return { remove: jest.fn() };
        });

        render(<NotificationsBridge />, { wrapper: buildApiWrapper().wrapper });
        await waitFor(() => expect(handler).toBeDefined());

        return (data: Record<string, unknown>) => {
            act(() => {
                handler?.({ notification: { request: { content: { data } } } });
            });
        };
    }

    it('shows an informational banner for a lifecycle push.', async () => {
        getPermissionsAsync.mockResolvedValueOnce(buildPermission({ granted: true, status: 'granted' }));
        getExpoPushTokenAsync.mockResolvedValueOnce({ data: 'ExponentPushToken[xyz]', type: 'expo' });
        mockFetch.mockResolvedValue(jsonResponse({ status: 'registered' }));

        let receivedHandler: ((event: unknown) => void) | undefined;
        addNotificationReceivedListener.mockImplementation((handler: (event: unknown) => void) => {
            receivedHandler = handler;
            return { remove: jest.fn() };
        });

        render(<NotificationsBridge />, { wrapper: buildApiWrapper().wrapper });
        await waitFor(() => expect(receivedHandler).toBeDefined());

        act(() => {
            receivedHandler?.({
                request: {
                    content: {
                        title: 'Irrigation started',
                        body: 'Schedule started for the night of 2026-06-09.',
                        data: { category: 'scheduleStart' },
                    },
                },
            });
        });

        expect(screen.getByText('Irrigation started')).toBeOnTheScreen();
        expect(screen.getByText('Schedule started for the night of 2026-06-09.')).toBeOnTheScreen();
    });

    it('routes a scheduleStart background tap to Home.', async () => {
        const fire = await captureResponseHandler();
        fire({ category: 'scheduleStart' });
        expect(mockPush).toHaveBeenCalledWith('/');
    });

    it('routes a scheduleEnd background tap to Home.', async () => {
        const fire = await captureResponseHandler();
        fire({ category: 'scheduleEnd' });
        expect(mockPush).toHaveBeenCalledWith('/');
    });

    it('routes a wateringStart background tap with a zoneId to that zone.', async () => {
        const fire = await captureResponseHandler();
        fire({ category: 'wateringStart', zoneId: 'zone-009' });
        expect(mockPush).toHaveBeenCalledWith('/zone/zone-009');
    });

    it('routes a wateringEnd background tap without a zoneId to the Activity feed.', async () => {
        const fire = await captureResponseHandler();
        fire({ category: 'wateringEnd' });
        expect(mockPush).toHaveBeenCalledWith('/activity');
    });

    it('routes when a lifecycle foreground banner is tapped, then dismisses it.', async () => {
        getPermissionsAsync.mockResolvedValueOnce(buildPermission({ granted: true, status: 'granted' }));
        getExpoPushTokenAsync.mockResolvedValueOnce({ data: 'ExponentPushToken[xyz]', type: 'expo' });
        mockFetch.mockResolvedValue(jsonResponse({ status: 'registered' }));

        let receivedHandler: ((event: unknown) => void) | undefined;
        addNotificationReceivedListener.mockImplementation((handler: (event: unknown) => void) => {
            receivedHandler = handler;
            return { remove: jest.fn() };
        });

        render(<NotificationsBridge />, { wrapper: buildApiWrapper().wrapper });
        await waitFor(() => expect(receivedHandler).toBeDefined());

        act(() => {
            receivedHandler?.({
                request: {
                    content: {
                        title: 'Watering started',
                        body: 'Front Lawn watering started (manual fire).',
                        data: { category: 'wateringStart', zoneId: 'zone-009' },
                    },
                },
            });
        });

        fireEvent.press(screen.getByLabelText('Notification: Watering started'));

        expect(mockPush).toHaveBeenCalledWith('/zone/zone-009');
        expect(screen.queryByText('Watering started')).toBeNull();
    });

    it('dismisses without navigating when a banner with no route is tapped.', async () => {
        getPermissionsAsync.mockResolvedValueOnce(buildPermission({ granted: true, status: 'granted' }));
        getExpoPushTokenAsync.mockResolvedValueOnce({ data: 'ExponentPushToken[xyz]', type: 'expo' });
        mockFetch.mockResolvedValue(jsonResponse({ status: 'registered' }));

        let receivedHandler: ((event: unknown) => void) | undefined;
        addNotificationReceivedListener.mockImplementation((handler: (event: unknown) => void) => {
            receivedHandler = handler;
            return { remove: jest.fn() };
        });

        render(<NotificationsBridge />, { wrapper: buildApiWrapper().wrapper });
        await waitFor(() => expect(receivedHandler).toBeDefined());

        // An alert push with no zoneId resolves to a null route.
        act(() => {
            receivedHandler?.({
                request: {
                    content: {
                        title: 'Weather data stale',
                        body: 'Planner is using fallback ET.',
                        data: { alertId: 'alert-9', tone: 'warn' },
                    },
                },
            });
        });

        fireEvent.press(screen.getByLabelText('Notification: Weather data stale'));

        expect(mockPush).not.toHaveBeenCalled();
        expect(screen.queryByText('Weather data stale')).toBeNull();
    });
});
