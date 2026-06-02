import { StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { NotificationSettingsView } from '@/components/notification-settings-view';
import { RefreshableScrollView } from '@/components/refreshable-scroll-view';

/**
 * Settings route — the destination for the drawer's Settings entry. Exposes
 * the notification toggles. `NotificationSettingsView` owns no scroll container
 * by design, so the route wraps it in a `RefreshableScrollView` (the
 * screen-level pull-to-refresh convention). File-based route at `/settings`
 * (APP-86).
 */
export default function SettingsScreen() {
    const insets = useSafeAreaInsets();
    return (
        <RefreshableScrollView
            contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
        >
            <NotificationSettingsView />
        </RefreshableScrollView>
    );
}

const styles = StyleSheet.create({
    content: {
        paddingTop: 16,
    },
});
