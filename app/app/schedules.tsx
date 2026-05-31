import { StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { RefreshableScrollView } from '@/components/refreshable-scroll-view';
import { ScheduleListView } from '@/components/schedule-list-view';

/**
 * Schedules route — the destination for the Home active-profile chip and the
 * drawer's Schedules / "Switch profile" entry points. `ScheduleListView` owns
 * no scroll container by design, so the route wraps it in a
 * `RefreshableScrollView` (the screen-level pull-to-refresh convention).
 * File-based route at `/schedules` (APP-85).
 */
export default function SchedulesScreen() {
    const insets = useSafeAreaInsets();
    return (
        <RefreshableScrollView
            contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
        >
            <ScheduleListView />
        </RefreshableScrollView>
    );
}

const styles = StyleSheet.create({
    content: {
        paddingTop: 16,
    },
});
