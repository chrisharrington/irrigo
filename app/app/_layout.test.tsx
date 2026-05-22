import { render, screen } from '@testing-library/react-native';

const mockUseFonts = jest.fn();
const mockHideAsync = jest.fn(() => Promise.resolve());
const mockStatusBar = jest.fn();

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
    Stack.Screen = () => null;
    return { Stack };
});

jest.mock('react-native-reanimated', () => ({}));

import RootLayout, { irrigoDarkTheme } from './_layout';

describe('RootLayout', () => {
    beforeEach(() => {
        mockUseFonts.mockReturnValue([true, null]);
        mockStatusBar.mockClear();
        mockHideAsync.mockClear();
    });

    it('renders the Irrigo canvas background under the navigation stack once fonts load.', () => {
        render(<RootLayout />);

        expect(screen.getByLabelText('Irrigo canvas')).toBeOnTheScreen();
        expect(screen.getByLabelText('Stack')).toBeOnTheScreen();
    });

    it('configures the status bar with the light style for the dark canvas.', () => {
        render(<RootLayout />);

        expect(mockStatusBar).toHaveBeenCalledWith(expect.objectContaining({ style: 'light' }));
    });

    it('exposes a dark-only theme whose background matches the canvas hex.', () => {
        expect(irrigoDarkTheme.dark).toBe(true);
        expect(irrigoDarkTheme.colors.background).toBe('#06090A');
    });
});
