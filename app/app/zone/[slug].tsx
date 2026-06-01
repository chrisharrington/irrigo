import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { FireSheet } from '@/components/fire-sheet';
import { RefreshableScrollView } from '@/components/refreshable-scroll-view';
import { ZoneDetail } from '@/components/zone-detail';
import { FontFamily } from '@/constants/fonts';
import { useActivity } from '@/hooks/activity';
import { useNextRun } from '@/hooks/next-run';
import { useZone } from '@/hooks/zone';
import { useCloseZone, useRunZone } from '@/hooks/zone-control';
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
    const runZone = useRunZone();
    const closeZone = useCloseZone();
    const [isFireSheetOpen, setFireSheetOpen] = useState<boolean>(false);

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
                onRunNow={() => setFireSheetOpen(true)}
                onStopWatering={() => closeZone.mutate(zone.id)}
                isStopping={closeZone.isPending}
                onViewActivity={() => router.push({ pathname: '/activity', params: { zoneId: zone.id } } as never)}
            />
            <FireSheet
                visible={isFireSheetOpen}
                zone={zone}
                onCancel={() => setFireSheetOpen(false)}
                onRun={durationMin => {
                    runZone.mutate(
                        { zoneId: zone.id, durationMin },
                        { onSettled: () => setFireSheetOpen(false) },
                    );
                }}
                isSubmitting={runZone.isPending}
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
