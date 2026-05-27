import { useLocalSearchParams } from 'expo-router';

import { ActivityView } from '@/components/activity-view';

/**
 * Activity route. Forwards an optional `zoneId` query param so deep links
 * (e.g. the "View all in Activity" link on Zone detail, APP-67) can seed
 * the chip-strip filter on mount.
 */
export default function ActivityScreen() {
    const { zoneId } = useLocalSearchParams<{ zoneId?: string }>();
    return <ActivityView initialZoneId={zoneId} />;
}
