import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AlertRegion } from '@/components/alert-region';
import { FireLog } from '@/components/fire-log';
import { FontFamily } from '@/constants/fonts';
import { useActivity } from '@/hooks/activity';
import { useNextRun } from '@/hooks/next-run';
import config from '@/tailwind.config';

const colors = config.theme.extend.colors;

const DEFAULT_TIMEZONE = 'UTC';

/**
 * Smart container for the Activity screen. Composes the eyebrow + page
 * title, the persistent alert region, and the chronological fire log
 * sourced from `GET /activity`. Reads `useNextRun()` only for the site
 * timezone (already cached after a Home-screen visit); falls back to UTC
 * when the cache hasn't been primed yet. RN port of `ActivityView` from
 * `Mobile.jsx`. APP-32.
 */
export function ActivityView() {
    const insets = useSafeAreaInsets();
    const activity = useActivity();
    const nextRun = useNextRun();
    const siteTimezone = nextRun.data?.timezone ?? DEFAULT_TIMEZONE;

    const rows = activity.data?.pages.flatMap(page => page.activity) ?? [];

    return (
        <ScrollView
            style={styles.scroll}
            contentContainerStyle={[styles.content, { paddingTop: 16, paddingBottom: insets.bottom + 32 }]}
        >
            <Text style={styles.eyebrow}>Chronological · all zones</Text>
            <Text style={styles.title}>Activity</Text>

            <AlertRegion />

            {activity.isPending ?
                <PlaceholderCard label='Loading activity…' />
            : activity.isError || activity.data === undefined ?
                <PlaceholderCard label='Failed to load activity.' tone='error' />
            : rows.length === 0 ?
                <PlaceholderCard label='No runs yet.' />
            :   <FireLog rows={rows} siteTimezone={siteTimezone} />}
        </ScrollView>
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
