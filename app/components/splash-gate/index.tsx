import { useEffect, useRef, useState, type PropsWithChildren } from 'react';
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

import { useNextRun } from '@/hooks/next-run';
import { useSchedules } from '@/hooks/schedules';
import { useSystem } from '@/hooks/system';
import { useZones } from '@/hooks/zones';

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

// Backstop: drop the splash unconditionally after this long, even if a data
// hook is still pending. Prevents the splash from holding forever if the
// API is unreachable on cold start.
const BACKSTOP_MS = 5000;

/**
 * Splash-screen gate that owns "everything the native splash waits for" on
 * cold start. Loads the Irrigo brand fonts and primes the four home-screen
 * data hooks (`useSystem`, `useNextRun`, `useZones`, `useSchedules`) in
 * parallel; only once fonts AND every hook have resolved (or errored) does
 * it call `SplashScreen.hideAsync()`. A 5-second backstop timer drops the
 * splash regardless if a query hangs.
 *
 * Children render unconditionally — the native splash covers them until
 * `hideAsync` fires, so when the splash drops the user sees a populated
 * HomeView in one beat instead of a flickery cascade of per-section
 * "Loading…" placeholders. APP-51.
 */
export function SplashGate({ children }: PropsWithChildren) {
    const [loaded, error] = useFonts(BRAND_FONTS);
    const system = useSystem();
    const nextRun = useNextRun();
    const zones = useZones();
    const schedules = useSchedules();
    const [timedOut, setTimedOut] = useState<boolean>(false);
    const hidden = useRef<boolean>(false);

    useEffect(() => {
        const id = setTimeout(() => setTimedOut(true), BACKSTOP_MS);
        return () => clearTimeout(id);
    }, []);

    const fontsReady = loaded || error !== null;
    const dataReady = !system.isPending && !nextRun.isPending && !zones.isPending && !schedules.isPending;
    const ready = (fontsReady && dataReady) || timedOut;

    useEffect(() => {
        if (!ready || hidden.current) return;
        hidden.current = true;
        if (error !== null) {
            console.warn('splash: brand fonts failed to load; rendering with system fallbacks.', error);
        }
        if (timedOut && !(fontsReady && dataReady)) {
            console.warn('splash: backstop timer fired before fonts/data resolved; dropping anyway.');
        }
        SplashScreen.hideAsync().catch(err => {
            console.warn('splash: SplashScreen.hideAsync failed; swallowing.', err);
        });
    }, [ready, error, timedOut, fontsReady, dataReady]);

    return <>{children}</>;
}
