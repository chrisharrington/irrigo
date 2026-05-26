import { act, fireEvent, render, screen } from '@testing-library/react-native';

const mockUseFonts = jest.fn();
const mockHideAsync = jest.fn(() => Promise.resolve());
const mockStatusBar = jest.fn();
const mockStackScreen = jest.fn();
const mockRouterPush = jest.fn();
const mockUsePathname = jest.fn(() => '/');
const mockHeaderProps = jest.fn();
const mockDrawerProps = jest.fn();

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
        useRouter: () => ({ push: mockRouterPush }),
        usePathname: () => mockUsePathname(),
    };
});

// SplashGate kicks off four data-hook queries on mount. Stand it in as a
// passthrough so the layout test doesn't need to seed `/system`, `/tonight`,
// `/zones`, and `/schedules` fetches just to render the chrome. The gate's
// own behaviour is covered under @/components/splash-gate.
jest.mock('@/components/splash-gate', () => {
    return {
        SplashGate: ({ children }: { children: React.ReactNode }) => children,
    };
});

// Stand-ins for Header and NavDrawer keep this layout test focused on
// wiring (does the layout render them? does it pass the right props?)
// without dragging in React Query plumbing that the components themselves
// already cover under @/components/header and @/components/nav-drawer.
jest.mock('@/components/header', () => {
    const { Pressable, Text, View } = require('react-native');
    return {
        Header: (props: { onMenuPress: () => void }) => {
            mockHeaderProps(props);
            return (
                <View accessibilityLabel='App header'>
                    <Pressable accessibilityLabel='Open menu' onPress={props.onMenuPress}>
                        <Text>menu</Text>
                    </Pressable>
                </View>
            );
        },
    };
});

jest.mock('@/components/nav-drawer', () => {
    const { Text, View } = require('react-native');
    return {
        NavDrawer: (props: {
            visible: boolean;
            activeId: string;
            onClose: () => void;
            onSelect: (id: string) => void;
        }) => {
            mockDrawerProps(props);
            return (
                <View
                    accessibilityLabel='Navigation drawer'
                    accessibilityState={{ expanded: props.visible }}
                >
                    <Text>active:{props.activeId}</Text>
                </View>
            );
        },
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
        mockRouterPush.mockReset();
        mockUsePathname.mockReset();
        mockUsePathname.mockReturnValue('/');
        mockHeaderProps.mockClear();
        mockDrawerProps.mockClear();
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

    it('renders the app header above the stack (APP-58).', () => {
        render(<RootLayout />);

        expect(screen.getByLabelText('App header')).toBeOnTheScreen();
    });

    it('renders the nav drawer hidden by default (APP-58).', () => {
        render(<RootLayout />);

        const drawer = screen.getByLabelText('Navigation drawer');
        expect(drawer).toBeOnTheScreen();
        expect(drawer.props.accessibilityState).toMatchObject({ expanded: false });
    });

    it('opens the drawer when the header menu button is pressed (APP-58).', () => {
        render(<RootLayout />);

        fireEvent.press(screen.getByLabelText('Open menu'));

        expect(screen.getByLabelText('Navigation drawer').props.accessibilityState).toMatchObject({ expanded: true });
    });

    it('passes activeId derived from usePathname to the drawer (APP-58).', () => {
        mockUsePathname.mockReturnValue('/schedules');

        render(<RootLayout />);

        expect(screen.getByText('active:schedules')).toBeOnTheScreen();
    });

    it('maps /zone/<slug> paths onto the zones nav id (APP-58).', () => {
        mockUsePathname.mockReturnValue('/zone/north');

        render(<RootLayout />);

        expect(screen.getByText('active:zones')).toBeOnTheScreen();
    });

    it('maps /activity onto the activity nav id (APP-58).', () => {
        mockUsePathname.mockReturnValue('/activity');

        render(<RootLayout />);

        expect(screen.getByText('active:activity')).toBeOnTheScreen();
    });

    it('falls back to the home nav id for unknown pathnames (APP-58).', () => {
        mockUsePathname.mockReturnValue('/unknown-route');

        render(<RootLayout />);

        expect(screen.getByText('active:home')).toBeOnTheScreen();
    });

    it('routes via expo-router when the drawer selects a destination (APP-58).', () => {
        render(<RootLayout />);

        // The drawer stand-in captured the onSelect prop; invoke it directly
        // to verify routing without driving the real drawer animation.
        const drawerProps = mockDrawerProps.mock.calls.at(-1)?.[0] as { onSelect: (id: string) => void };
        drawerProps.onSelect('schedules');

        expect(mockRouterPush).toHaveBeenCalledWith('/schedules');
    });

    it('collapses the drawer when its onClose handler fires (APP-58).', () => {
        render(<RootLayout />);

        // Open the drawer first.
        fireEvent.press(screen.getByLabelText('Open menu'));
        expect(screen.getByLabelText('Navigation drawer').props.accessibilityState).toMatchObject({ expanded: true });

        // Then trigger onClose via the captured drawer prop (wrapped in act
        // so the React Native state update commits before the assertion).
        const drawerProps = mockDrawerProps.mock.calls.at(-1)?.[0] as { onClose: () => void };
        act(() => {
            drawerProps.onClose();
        });

        expect(screen.getByLabelText('Navigation drawer').props.accessibilityState).toMatchObject({ expanded: false });
    });
});
