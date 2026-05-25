import { DarkTheme, ThemeProvider, type Theme } from '@react-navigation/native';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ApiProvider } from '@/api/provider';
import { FontLoader } from '@/components/font-loader';
import { NotificationsBridge } from '@/components/notifications-bridge';
import { StatusBarBackdrop } from '@/components/status-bar-backdrop';
import '../global.css';

// Hold the native splash from auto-hiding so FontLoader can keep it visible
// until the brand fonts are ready. Per Expo SDK 54 docs, this must be called
// at module scope (not inside a component) so it executes before any tree
// renders. The promise is intentionally not awaited.
SplashScreen.preventAutoHideAsync().catch(err => {
    console.warn('splash: preventAutoHideAsync failed; the splash may close before fonts load.', err);
});

// Dark-only React Navigation theme. Irrigo has no light mode by design, so
// we don't branch on `useColorScheme()` — the OS scheme is pinned to dark
// via `userInterfaceStyle: "dark"` in app.json. The background paints behind
// any screen that doesn't supply its own backdrop — plain black per APP-52.
export const irrigoDarkTheme: Theme = {
    ...DarkTheme,
    colors: {
        ...DarkTheme.colors,
        background: '#000000',
    },
};

export default function RootLayout() {
    return (
        <ApiProvider>
            <FontLoader>
                <SafeAreaProvider>
                    <ThemeProvider value={irrigoDarkTheme}>
                        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#000000' } }}>
                            <Stack.Screen name='modal' options={{ presentation: 'modal', title: 'Modal' }} />
                        </Stack>
                        <NotificationsBridge />
                        <StatusBarBackdrop />
                        <StatusBar style='light' />
                    </ThemeProvider>
                </SafeAreaProvider>
            </FontLoader>
        </ApiProvider>
    );
}
