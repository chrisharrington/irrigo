import { useEffect, type PropsWithChildren } from 'react';
import { useFonts } from 'expo-font';
import {
    BricolageGrotesque_400Regular,
    BricolageGrotesque_500Medium,
    BricolageGrotesque_600SemiBold,
    BricolageGrotesque_700Bold,
} from '@expo-google-fonts/bricolage-grotesque';
import {
    Geist_300Light,
    Geist_400Regular,
    Geist_500Medium,
    Geist_600SemiBold,
    Geist_700Bold,
} from '@expo-google-fonts/geist';
import {
    GeistMono_400Regular,
    GeistMono_500Medium,
    GeistMono_600SemiBold,
} from '@expo-google-fonts/geist-mono';

const BRAND_FONTS = {
    BricolageGrotesque_400Regular,
    BricolageGrotesque_500Medium,
    BricolageGrotesque_600SemiBold,
    BricolageGrotesque_700Bold,
    Geist_300Light,
    Geist_400Regular,
    Geist_500Medium,
    Geist_600SemiBold,
    Geist_700Bold,
    GeistMono_400Regular,
    GeistMono_500Medium,
    GeistMono_600SemiBold,
};

/**
 * Font-loading gate. Holds the children render until the Irrigo brand fonts
 * are registered, so nothing paints with system fallbacks while the splash
 * is up. Returns `null` until fonts are loaded — `preventAutoHideAsync()`
 * at the layout module scope keeps the native splash visible while we wait.
 *
 * The splash is hidden by `HomeView` once the home-screen data hooks have
 * resolved (APP-51): the screen that depends on the data also owns the
 * decision to drop the splash.
 *
 * Font failures are logged at warn and treated as "ready enough" — system
 * fallback rendering is preferable to a frozen splash.
 */
export function SplashGate({ children }: PropsWithChildren) {
    const [loaded, error] = useFonts(BRAND_FONTS);

    useEffect(() => {
        if (error !== null) {
            console.warn('splash: brand fonts failed to load; rendering with system fallbacks.', error);
        }
    }, [error]);

    if (!loaded && error === null) return null;
    return <>{children}</>;
}
