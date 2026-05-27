import { router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { RefreshableScrollView } from '@/components/refreshable-scroll-view';
import { ZoneDetail } from '@/components/zone-detail';
import { FontFamily } from '@/constants/fonts';
import { useActivity } from '@/hooks/activity';
import { useNextRun } from '@/hooks/next-run';
import { useZone } from '@/hooks/zone';
import config from '@/tailwind.config';

const colors = config.theme.extend.colors;

/**
 * Zone detail route. Composes `useZone`, `useNextRun`, and `useActivity`
 * into the `<ZoneDetail>` body. Redirects to Home when the route slug
 * doesn't match any known zone (stale deep link).
 */
export default function ZoneScreen() {
    const { slug } = useLocalSearchParams<{ slug: string }>();
    const { zone, isPending } = useZone(slug);
    const nextRun = useNextRun();
    const activity = useActivity({ zoneId: zone?.id });

    // Redirect when the slug doesn't match any zone in the loaded list.
    const shouldRedirect = !isPending && zone === undefined;
    useEffect(() => {
        if (shouldRedirect) router.replace('/' as never);
    }, [shouldRedirect]);

    if (isPending) {
        return (
            <RefreshableScrollView>
                <Text style={styles.hint}>Loading zone…</Text>
            </RefreshableScrollView>
        );
    }

    if (zone === undefined) {
        // The effect above will fire on the next paint; render nothing in
        // the meantime so we don't flash an empty layout.
        return <View />;
    }

    const flattened = activity.data?.pages.flatMap(page => page.activity) ?? [];

    return (
        <RefreshableScrollView>
            <ZoneDetail
                zone={zone}
                nextRun={nextRun.data}
                activity={flattened}
                isActivityLoading={activity.isPending}
                onRunNow={() => {}}
            />
        </RefreshableScrollView>
    );
}

const styles = StyleSheet.create({
    hint: {
        padding: 20,
        fontFamily: FontFamily.sans,
        fontSize: 13,
        lineHeight: 17,
        color: colors['fg-muted'],
    },
});
