import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

const mockUseFonts = jest.fn();
const mockHideAsync = jest.fn(() => Promise.resolve());

jest.mock('expo-font', () => ({
    useFonts: (...args: unknown[]) => mockUseFonts(...args),
}));

jest.mock('expo-splash-screen', () => ({
    preventAutoHideAsync: jest.fn(() => Promise.resolve()),
    hideAsync: () => mockHideAsync(),
}));

import { FontLoader } from './font-loader';

describe('FontLoader', () => {
    beforeEach(() => {
        mockUseFonts.mockReset();
        mockHideAsync.mockClear();
    });

    it('does not render children while fonts are still loading', () => {
        mockUseFonts.mockReturnValue([false, null]);

        render(
            <FontLoader>
                <Text>Welcome to Irrigo.</Text>
            </FontLoader>,
        );

        expect(screen.queryByText('Welcome to Irrigo.')).toBeNull();
        expect(mockHideAsync).not.toHaveBeenCalled();
    });

    it('renders children and hides the splash once fonts finish loading', () => {
        mockUseFonts.mockReturnValue([true, null]);

        render(
            <FontLoader>
                <Text>Welcome to Irrigo.</Text>
            </FontLoader>,
        );

        expect(screen.getByText('Welcome to Irrigo.')).toBeOnTheScreen();
        expect(mockHideAsync).toHaveBeenCalledTimes(1);
    });

    it('still renders children and warns when font loading errors out', () => {
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
        mockUseFonts.mockReturnValue([false, new Error('network down')]);

        render(
            <FontLoader>
                <Text>Welcome to Irrigo.</Text>
            </FontLoader>,
        );

        expect(screen.getByText('Welcome to Irrigo.')).toBeOnTheScreen();
        expect(mockHideAsync).toHaveBeenCalledTimes(1);
        expect(warnSpy).toHaveBeenCalled();
        warnSpy.mockRestore();
    });
});
