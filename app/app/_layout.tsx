import { useState } from 'react';
import { View } from 'react-native';
import { DarkTheme, Stack, ThemeProvider, usePathname, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiProvider } from '@/api/provider';
import { Header } from '@/components/header';
import { NavDrawer, type NavItemId } from '@/components/nav-drawer';
import { NotificationsBridge } from '@/components/notifications-bridge';
import { ReachabilityGate } from '@/components/reachability-gate';
import { SplashGate } from '@/components/splash-gate';
import { StatusBarBackdrop } from '@/components/status-bar-backdrop';
import '../global.css';

// Hold the native splash from auto-hiding so SplashGate can keep it visible
// until fonts AND the home-screen data hooks have resolved. Per Expo SDK 54
// docs, this must be called at module scope (not inside a component) so it
// executes before any tree renders. The promise is intentionally not awaited.
SplashScreen.preventAutoHideAsync().catch(err => {
    console.warn('splash: preventAutoHideAsync failed; the splash may close before fonts load.', err);
});

// Dark-only React Navigation theme. Irrigo has no light mode by design, so
// we don't branch on `useColorScheme()` — the OS scheme is pinned to dark
// via `userInterfaceStyle: "dark"` in app.json. The background paints behind
// any screen that doesn't supply its own backdrop — plain black per APP-52.
export const irrigoDarkTheme: typeof DarkTheme = {
    ...DarkTheme,
    colors: {
        ...DarkTheme.colors,
        background: '#000000',
    },
};

const ROUTE_FOR_NAV_ID: Record<NavItemId, string> = {
    home: '/',
    schedules: '/schedules',
    activity: '/activity',
    settings: '/settings',
};

function pathnameToActiveId(pathname: string): NavItemId {
    // Strip trailing 's' off each plural id so a `/schedule/<slug>`-style
    // detail route would still resolve to the same nav id as its `/schedules`
    // list. Zone detail pages (`/zone/<slug>`) have no nav id since the Zones
    // entry was removed (APP-102), so they fall back to 'home'.
    return (Object.keys(ROUTE_FOR_NAV_ID) as NavItemId[]).find(
        id => id !== 'home' && pathname.startsWith('/' + id.replace(/s$/, '')),
    ) ?? 'home';
}

export default function RootLayout() {
    return (
        <ApiProvider>
            <SplashGate>
                <ReachabilityGate>
                    <SafeAreaProvider>
                        <ThemeProvider value={irrigoDarkTheme}>
                            <AppShell />
                            <NotificationsBridge />
                            <StatusBarBackdrop />
                            <StatusBar style='light' />
                        </ThemeProvider>
                    </SafeAreaProvider>
                </ReachabilityGate>
            </SplashGate>
        </ApiProvider>
    );
}

/**
 * Renders the persistent app chrome (header + drawer) around the route
 * stack. Owns the drawer's open/closed state and maps the current
 * `usePathname()` onto the drawer's `activeId`. APP-22 / APP-58.
 */
function AppShell() {
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const pathname = usePathname();
    const [drawerOpen, setDrawerOpen] = useState(false);
    const activeId = pathnameToActiveId(pathname);

    return (
        <View style={{ flex: 1 }}>
            <View style={{ paddingTop: insets.top, backgroundColor: '#000000' }}>
                <Header
                    onMenuPress={() => setDrawerOpen(true)}
                    // `navigate` (not `push`) so re-tapping the bell while
                    // already on /alerts is a no-op instead of stacking a
                    // duplicate screen the user has to unwind on back-press
                    // (APP-101). NAVIGATE dedupes on the focused route.
                    onAlertsPress={() => router.navigate('/alerts' as never)}
                />
            </View>
            <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#000000' } }}>
                <Stack.Screen name='modal' options={{ presentation: 'modal', title: 'Modal' }} />
            </Stack>
            <NavDrawer
                visible={drawerOpen}
                onClose={() => setDrawerOpen(false)}
                activeId={activeId}
                onSelect={(id) => router.push(ROUTE_FOR_NAV_ID[id] as never)}
            />
        </View>
    );
}
