import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

const mockUseFonts = jest.fn();

jest.mock('expo-font', () => ({
    useFonts: (...args: unknown[]) => mockUseFonts(...args),
}));

import { SplashGate } from '.';

describe('SplashGate', () => {
    beforeEach(() => {
        mockUseFonts.mockReset();
    });

    it('does not render children while fonts are still loading.', () => {
        mockUseFonts.mockReturnValue([false, null]);

        render(
            <SplashGate>
                <Text>Welcome to Irrigo.</Text>
            </SplashGate>,
        );

        // No children → splash (held by preventAutoHideAsync at the layout
        // module scope) stays up while fonts load.
        expect(screen.queryByText('Welcome to Irrigo.')).toBeNull();
    });

    it('renders children once fonts finish loading.', () => {
        mockUseFonts.mockReturnValue([true, null]);

        render(
            <SplashGate>
                <Text>Welcome to Irrigo.</Text>
            </SplashGate>,
        );

        expect(screen.getByText('Welcome to Irrigo.')).toBeOnTheScreen();
    });

    it('still renders children and warns when font loading errors out — system fallbacks beat a frozen splash.', () => {
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
        mockUseFonts.mockReturnValue([false, new Error('network down')]);

        render(
            <SplashGate>
                <Text>Welcome to Irrigo.</Text>
            </SplashGate>,
        );

        expect(screen.getByText('Welcome to Irrigo.')).toBeOnTheScreen();
        expect(warnSpy.mock.calls.some(call => String(call[0]).includes('brand fonts failed'))).toBe(true);
        warnSpy.mockRestore();
    });
});
