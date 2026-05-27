import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FireLog } from '@/components/fire-log';
import { RefreshableScrollView } from '@/components/refreshable-scroll-view';
import { ZoneFilterChipStrip } from '@/components/zone-filter-chip-strip';
import { FontFamily } from '@/constants/fonts';
import { useActivity } from '@/hooks/activity';
import { useNextRun } from '@/hooks/next-run';
import { useZones } from '@/hooks/zones';
import config from '@/tailwind.config';

const colors = config.theme.extend.colors;

const DEFAULT_TIMEZONE = 'UTC';
const ALL_ZONES_LABEL = 'all zones';

/**
 * Props for the Activity smart container.
 */
export type ActivityViewProps = {
    /**
     * Optional. Zone id to preselect in the filter chip strip on first
     * render. Threaded from the route's `zoneId` query param so that the
     * "View all in Activity" link on Zone detail (APP-67) lands here with
     * the originating zone already filtered. The chip strip stays
     * user-controlled afterwards — taps on other chips replace the
     * selection as normal.
     */
    initialZoneId?: string;
};

/**
 * Smart container for the Activity screen. Composes the eyebrow + page
 * title with a zone-filter chip strip and the chronological fire log
 * sourced from `GET /activity`. Reads `useNextRun()` only for the site
 * timezone (already cached after a Home-screen visit); falls back to UTC
 * when the cache hasn't been primed yet. Selecting a zone chip flips
 * `useActivity({ zoneId })`'s query key, which React Query treats as a
 * fresh query — so the fire log re-fetches the first page automatically.
 * RN port of `ActivityView` from `Mobile.jsx` — minus the alert region,
 * since alerts have no dismiss affordance yet and lingering non-
 * interactive copy is worse than silence here. APP-32 / APP-61 / APP-67.
 */
export function ActivityView({ initialZoneId }: ActivityViewProps = {}) {
    const insets = useSafeAreaInsets();
    const [selectedZoneId, setSelectedZoneId] = useState<string | undefined>(initialZoneId);
    const activity = useActivity({ ...(selectedZoneId !== undefined ? { zoneId: selectedZoneId } : {}) });
    const nextRun = useNextRun();
    const zones = useZones();
    const siteTimezone = nextRun.data?.timezone ?? DEFAULT_TIMEZONE;

    const rows = activity.data?.pages.flatMap(page => page.activity) ?? [];
    const selectedZoneName = selectedZoneId === undefined
        ? null
        : zones.data?.find(zone => zone.id === selectedZoneId)?.name ?? null;
    const eyebrowSuffix = selectedZoneName ?? ALL_ZONES_LABEL;

    return (
        <RefreshableScrollView
            style={styles.scroll}
            contentContainerStyle={[styles.content, { paddingTop: 16, paddingBottom: insets.bottom + 32 }]}
        >
            <Text style={[styles.eyebrow, styles.inset]}>Chronological · {eyebrowSuffix}</Text>
            <Text style={[styles.title, styles.inset]}>Activity</Text>

            <ZoneFilterChipStrip
                zones={zones.data ?? []}
                selectedZoneId={selectedZoneId}
                onSelect={setSelectedZoneId}
            />

            <View style={styles.inset}>
                {activity.isPending ?
                    <PlaceholderCard label='Loading activity…' />
                : activity.isError || activity.data === undefined ?
                    <PlaceholderCard label='Failed to load activity.' tone='error' />
                : rows.length === 0 ?
                    <PlaceholderCard label='No runs yet.' />
                :   <FireLog rows={rows} siteTimezone={siteTimezone} />}
            </View>
        </RefreshableScrollView>
    );
}

function PlaceholderCard({ label, tone = 'muted' }: { label: string; tone?: 'muted' | 'error' }) {
    return (
        <View style={[styles.placeholder, tone === 'error' ? styles.placeholderError : null]}>
            <Text
                style={[
                    styles.placeholderText,
                    tone === 'error' ? { color: colors.warn } : { color: colors['fg-muted'] },
                ]}
            >
                {label}
            </Text>
        </View>
    );
}

const styles = StyleSheet.create({
    scroll: {
        flex: 1,
    },
    content: {
        gap: 18,
    },
    inset: {
        // Most rows sit 20px in from the screen edge; the chip strip skips
        // this so it can scroll edge-to-edge while keeping its own internal
        // padding aligned with the rest of the content.
        paddingHorizontal: 20,
    },
    eyebrow: {
        fontFamily: FontFamily.sansMedium,
        fontSize: 11,
        lineHeight: 13,
        letterSpacing: 1.54,
        color: colors['fg-muted'],
        textTransform: 'uppercase',
    },
    title: {
        fontFamily: FontFamily.displayBold,
        fontSize: 28,
        lineHeight: 28,
        letterSpacing: -0.7,
        color: colors.fg,
    },
    placeholder: {
        padding: 14,
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 4,
    },
    placeholderError: {
        borderColor: colors['warn-border'],
        backgroundColor: colors['warn-tint'],
    },
    placeholderText: {
        fontFamily: FontFamily.sans,
        fontSize: 12,
        lineHeight: 17,
    },
});
