import { useEffect, type PropsWithChildren } from 'react';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
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
 * Splash-screen-gated wrapper that loads the Irrigo brand fonts (Bricolage
 * Grotesque, Geist, Geist Mono) before rendering its children. Returns `null`
 * while fonts are loading so the native splash configured in `app.json`
 * stays visible. Once fonts finish loading — or fail — the splash is hidden
 * and children render. A font load failure is logged at `warn` and does not
 * lock the UI, since rendering with system fallbacks is still better than a
 * blank screen.
 */
export function FontLoader({ children }: PropsWithChildren) {
    const [loaded, error] = useFonts(BRAND_FONTS);

    useEffect(() => {
        if (!loaded && !error) return;
        if (error) console.warn('fonts: failed to load brand fonts; rendering with system fallbacks.', error);
        SplashScreen.hideAsync().catch(err => {
            console.warn('fonts: SplashScreen.hideAsync failed; swallowing.', err);
        });
    }, [loaded, error]);

    if (!loaded && !error) return null;
    return <>{children}</>;
}
