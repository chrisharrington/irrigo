import { act, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

const mockUseFonts = jest.fn();
const mockHideAsync = jest.fn(() => Promise.resolve());
const mockUseSystem = jest.fn();
const mockUseNextRun = jest.fn();
const mockUseZones = jest.fn();
const mockUseSchedules = jest.fn();

jest.mock('expo-font', () => ({
    useFonts: (...args: unknown[]) => mockUseFonts(...args),
}));

jest.mock('expo-splash-screen', () => ({
    preventAutoHideAsync: jest.fn(() => Promise.resolve()),
    hideAsync: () => mockHideAsync(),
}));

jest.mock('@/hooks/system', () => ({ useSystem: () => mockUseSystem() }));
jest.mock('@/hooks/next-run', () => ({ useNextRun: () => mockUseNextRun() }));
jest.mock('@/hooks/zones', () => ({ useZones: () => mockUseZones() }));
jest.mock('@/hooks/schedules', () => ({ useSchedules: () => mockUseSchedules() }));

import { SplashGate } from '.';

// SplashGate defers hideAsync into the next animation frame so React's
// commit lands first. Most tests just need the call to have happened, so
// we synchronously flush the rAF callback before asserting.
const originalRAF = globalThis.requestAnimationFrame;
beforeAll(() => {
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
        cb(0);
        return 0;
    }) as typeof globalThis.requestAnimationFrame;
});
afterAll(() => {
    globalThis.requestAnimationFrame = originalRAF;
});

const ready = { isPending: false };
const pending = { isPending: true };

function seedHooks(overrides?: {
    fontsLoaded?: boolean;
    fontsError?: Error | null;
    system?: { isPending: boolean };
    nextRun?: { isPending: boolean };
    zones?: { isPending: boolean };
    schedules?: { isPending: boolean };
}) {
    mockUseFonts.mockReturnValue([
        overrides?.fontsLoaded ?? true,
        overrides?.fontsError ?? null,
    ]);
    mockUseSystem.mockReturnValue(overrides?.system ?? ready);
    mockUseNextRun.mockReturnValue(overrides?.nextRun ?? ready);
    mockUseZones.mockReturnValue(overrides?.zones ?? ready);
    mockUseSchedules.mockReturnValue(overrides?.schedules ?? ready);
}

describe('SplashGate', () => {
    beforeEach(() => {
        mockUseFonts.mockReset();
        mockHideAsync.mockClear();
        mockUseSystem.mockReset();
        mockUseNextRun.mockReset();
        mockUseZones.mockReset();
        mockUseSchedules.mockReset();
    });

    it('renders its children unconditionally, even when fonts and every hook are still pending.', () => {
        seedHooks({ fontsLoaded: false, system: pending, nextRun: pending, zones: pending, schedules: pending });

        render(
            <SplashGate>
                <Text>Welcome to Irrigo.</Text>
            </SplashGate>,
        );

        // The native splash covers the children at runtime; in the test
        // tree they're always present so the JS shell is ready the moment
        // hideAsync fires.
        expect(screen.getByText('Welcome to Irrigo.')).toBeOnTheScreen();
    });

    it('does not call hideAsync while fonts are still loading.', () => {
        seedHooks({ fontsLoaded: false });

        render(<SplashGate><Text>x</Text></SplashGate>);

        expect(mockHideAsync).not.toHaveBeenCalled();
    });

    it('does not call hideAsync while any data hook reports isPending.', () => {
        seedHooks({ zones: pending });

        render(<SplashGate><Text>x</Text></SplashGate>);

        expect(mockHideAsync).not.toHaveBeenCalled();
    });

    it('calls hideAsync exactly once when fonts and every data hook resolve.', () => {
        seedHooks();

        render(<SplashGate><Text>x</Text></SplashGate>);

        expect(mockHideAsync).toHaveBeenCalledTimes(1);
    });

    it('calls hideAsync when a data hook resolves to an error state (isPending: false).', () => {
        // React Query flips isPending to false on both success and error.
        // The gate treats either as "ready" so a backend failure doesn't
        // hold the splash forever.
        seedHooks({ zones: { isPending: false } });

        render(<SplashGate><Text>x</Text></SplashGate>);

        expect(mockHideAsync).toHaveBeenCalledTimes(1);
    });

    it('does not call hideAsync at the old 5-second backstop point (data should still get a chance).', () => {
        jest.useFakeTimers();
        try {
            seedHooks({ system: pending, nextRun: pending, zones: pending, schedules: pending });

            render(<SplashGate><Text>x</Text></SplashGate>);

            // The old backstop was 5s and routinely fired before the home-screen
            // API calls finished. The current value (30s) gives them headroom.
            act(() => {
                jest.advanceTimersByTime(5_000);
            });

            expect(mockHideAsync).not.toHaveBeenCalled();
        } finally {
            jest.useRealTimers();
        }
    });

    it('calls hideAsync after the 30-second backstop timer even if data is still pending.', () => {
        jest.useFakeTimers();
        try {
            seedHooks({ system: pending, nextRun: pending, zones: pending, schedules: pending });
            const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

            render(<SplashGate><Text>x</Text></SplashGate>);
            expect(mockHideAsync).not.toHaveBeenCalled();

            act(() => {
                jest.advanceTimersByTime(30_000);
            });

            expect(mockHideAsync).toHaveBeenCalledTimes(1);
            expect(warnSpy.mock.calls.some(call => String(call[0]).includes('backstop'))).toBe(true);

            warnSpy.mockRestore();
        } finally {
            jest.useRealTimers();
        }
    });

    it('calls hideAsync and logs a warn when font loading errors out.', () => {
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
        seedHooks({ fontsLoaded: false, fontsError: new Error('network down') });

        render(<SplashGate><Text>x</Text></SplashGate>);

        expect(mockHideAsync).toHaveBeenCalledTimes(1);
        expect(warnSpy.mock.calls.some(call => String(call[0]).includes('brand fonts failed'))).toBe(true);
        warnSpy.mockRestore();
    });
});
