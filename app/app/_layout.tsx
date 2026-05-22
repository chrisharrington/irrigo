import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import 'react-native-reanimated';

import { ApiProvider } from '@/api/provider';
import { FontLoader } from '@/components/font-loader';
import { useColorScheme } from '@/hooks/use-color-scheme';
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

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <ApiProvider>
      <FontLoader>
        <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
          <Stack>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
          </Stack>
          <StatusBar style="auto" />
        </ThemeProvider>
      </FontLoader>
    </ApiProvider>
  );
}
