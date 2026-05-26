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

// Safety-net backstop: drop the splash unconditionally after this long,
// even if a data hook is still pending. 30s gives cold-start API calls
// over wifi plenty of headroom — anything beyond that, something is wrong
// and the user is better off seeing the home screen's own error placeholders
// than a frozen splash. Previously 5s, which routinely tripped before the
// home data finished loading (APP-51 comment thread).
const BACKSTOP_MS = 30_000;

/**
 * Splash-screen gate that owns "everything the native splash waits for" on
 * cold start. Loads the Irrigo brand fonts and primes the four home-screen
 * data hooks (`useSystem`, `useNextRun`, `useZones`, `useSchedules`) in
 * parallel; only once fonts AND every hook have produced data (or errored
 * terminally) does it call `SplashScreen.hideAsync()`. A 30-second backstop
 * timer drops the splash regardless if a query hangs.
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
    // Each query is "settled" when it has data OR has finished its retry
    // chain with a terminal error. `isPending` is true through retries (no
    // data yet, still fetching) and only flips to false when one of those
    // outcomes lands, so `!isPending` captures both.
    const settled = (q: { isPending: boolean }) => !q.isPending;
    const dataReady = settled(system) && settled(nextRun) && settled(zones) && settled(schedules);
    const ready = (fontsReady && dataReady) || timedOut;

    useEffect(() => {
        if (!ready || hidden.current) return;
        hidden.current = true;

        if (error !== null) {
            console.warn('splash: brand fonts failed to load; rendering with system fallbacks.', error);
        }
        if (timedOut && !(fontsReady && dataReady)) {
            console.warn('splash: backstop timer fired before fonts/data resolved; dropping anyway.', {
                fontsReady,
                dataReady,
                queries: {
                    system: !system.isPending,
                    nextRun: !nextRun.isPending,
                    zones: !zones.isPending,
                    schedules: !schedules.isPending,
                },
            });
        } else {
            console.log('splash: fonts + home data ready; dropping splash.');
        }

        // Defer the hide call by one frame so React's commit lands and
        // HomeView paints with real data BEFORE the native splash starts
        // its hide animation. Without this defer the user can briefly see
        // unrendered chrome between the splash drop and the data-bound
        // HomeView paint.
        requestAnimationFrame(() => {
            SplashScreen.hideAsync().catch(err => {
                console.warn('splash: SplashScreen.hideAsync failed; swallowing.', err);
            });
        });
    }, [ready, error, timedOut, fontsReady, dataReady, system.isPending, nextRun.isPending, zones.isPending, schedules.isPending]);

    return <>{children}</>;
}
