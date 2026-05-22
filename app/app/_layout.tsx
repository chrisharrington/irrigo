import { DarkTheme, ThemeProvider, type Theme } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import 'react-native-reanimated';

import { CanvasBackground } from '@/components/canvas-background';
import { FontLoader } from '@/components/font-loader';
import '../global.css';

// Hold the native splash from auto-hiding so FontLoader can keep it visible
// until the brand fonts are ready. Per Expo SDK 54 docs, this must be called
// at module scope (not inside a component) so it executes before any tree
// renders. The promise is intentionally not awaited.
SplashScreen.preventAutoHideAsync().catch(err => {
    console.warn('splash: preventAutoHideAsync failed; the splash may close before fonts load.', err);
});

export const unstable_settings = {
    anchor: '(tabs)',
};

// Dark-only React Navigation theme. Irrigo has no light mode by design, so
// we don't branch on `useColorScheme()` — the OS scheme is pinned to dark
// via `userInterfaceStyle: "dark"` in app.json. Background overrides the
// default `#000` so screens default to the canvas hex when they don't paint
// their own backdrop.
export const irrigoDarkTheme: Theme = {
    ...DarkTheme,
    colors: {
        ...DarkTheme.colors,
        background: '#06090A',
    },
};

export default function RootLayout() {
    return (
        <FontLoader>
            <ThemeProvider value={irrigoDarkTheme}>
                <CanvasBackground>
                    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: 'transparent' } }}>
                        <Stack.Screen name='(tabs)' />
                        <Stack.Screen name='modal' options={{ presentation: 'modal', title: 'Modal' }} />
                    </Stack>
                </CanvasBackground>
                <StatusBar style='light' />
            </ThemeProvider>
        </FontLoader>
    );
}
