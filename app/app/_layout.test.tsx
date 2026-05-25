import { render, screen } from '@testing-library/react-native';

const mockUseFonts = jest.fn();
const mockHideAsync = jest.fn(() => Promise.resolve());
const mockStatusBar = jest.fn();
const mockStackScreen = jest.fn();

jest.mock('expo-font', () => ({
    useFonts: (...args: unknown[]) => mockUseFonts(...args),
}));

jest.mock('expo-splash-screen', () => ({
    preventAutoHideAsync: jest.fn(() => Promise.resolve()),
    hideAsync: () => mockHideAsync(),
}));

jest.mock('expo-status-bar', () => ({
    StatusBar: (props: { style?: string }) => {
        mockStatusBar(props);
        return null;
    },
}));

jest.mock('expo-router', () => {
    const { View } = require('react-native');
    const Stack = ({ children }: { children?: React.ReactNode }) => (
        <View accessibilityLabel='Stack'>{children}</View>
    );
    Stack.Screen = (props: { name: string }) => {
        mockStackScreen(props);
        return null;
    };
    return {
        Stack,
        useRouter: () => ({ push: jest.fn() }),
    };
});

jest.mock('react-native-reanimated', () => ({}));

jest.mock('react-native-safe-area-context', () => {
    const { View } = require('react-native');
    return {
        SafeAreaProvider: ({ children }: { children?: React.ReactNode }) => (
            <View>{children}</View>
        ),
        useSafeAreaInsets: () => ({ top: 24, bottom: 0, left: 0, right: 0 }),
    };
});

// NotificationsBridge calls into expo-notifications and expo-device; the
// jest-expo preset provides default mocks, but the layout test runs
// before any test-level mocks are installed, so make the surface fully
// inert here.
jest.mock('expo-notifications', () => ({
    getPermissionsAsync: jest.fn().mockResolvedValue({ status: 'undetermined', granted: false, canAskAgain: true, expires: 'never' }),
    requestPermissionsAsync: jest.fn().mockResolvedValue({ status: 'denied', granted: false, canAskAgain: false, expires: 'never' }),
    getExpoPushTokenAsync: jest.fn(),
    setNotificationHandler: jest.fn(),
    addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
    addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
    PermissionStatus: { UNDETERMINED: 'undetermined', GRANTED: 'granted', DENIED: 'denied' },
}));

jest.mock('expo-device', () => ({
    modelName: 'Test Device',
    osName: 'TestOS',
    osVersion: '1.0',
}));

import RootLayout, { irrigoDarkTheme } from './_layout';

describe('RootLayout', () => {
    beforeEach(() => {
        mockUseFonts.mockReturnValue([true, null]);
        mockStatusBar.mockClear();
        mockHideAsync.mockClear();
        mockStackScreen.mockClear();
    });

    it('renders the navigation stack once fonts load.', () => {
        render(<RootLayout />);

        expect(screen.getByLabelText('Stack')).toBeOnTheScreen();
    });

    it('configures the status bar with the light style for the dark canvas.', () => {
        render(<RootLayout />);

        expect(mockStatusBar).toHaveBeenCalledWith(expect.objectContaining({ style: 'light' }));
    });

    it('exposes a dark-only theme whose background is plain black (APP-52).', () => {
        expect(irrigoDarkTheme.dark).toBe(true);
        expect(irrigoDarkTheme.colors.background).toBe('#000000');
    });

    it('registers the modal screen and no longer registers the legacy (tabs) anchor.', () => {
        render(<RootLayout />);

        const registeredNames = mockStackScreen.mock.calls.map(([props]) => props.name);
        expect(registeredNames).toContain('modal');
        expect(registeredNames).not.toContain('(tabs)');
    });

    it('paints the opaque status-bar backdrop so the system bar is not transparent (APP-50).', () => {
        render(<RootLayout />);

        expect(screen.getByLabelText('Status bar backdrop')).toBeOnTheScreen();
    });
});
