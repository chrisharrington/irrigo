import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { Check, ChevR } from '@/components/icons';
import { FontFamily } from '@/constants/fonts';
import config from '@/tailwind.config';

const colors = config.theme.extend.colors;

/**
 * The Alerts screen's empty state — shown when there are no active alerts.
 * RN port of the mock's `EmptyState`: an accent-bordered check glyph, a
 * "system is healthy" message (not "no data"), and a shortcut into the
 * activity log. Reads as reassurance rather than absence.
 */
export function EmptyState() {
    const router = useRouter();

    return (
        <View style={styles.container}>
            {/* Lit-from-below check tile — 'healthy', not 'empty'. */}
            <View style={styles.glyphTile}>
                <Check size={22} color={colors.accent} accessibilityLabel='Healthy' />
            </View>

            <Text style={styles.heading}>No active alerts</Text>
            <Text style={styles.sub}>
                Planner is healthy. The last 30 days of activity is in the log.
            </Text>

            <Pressable
                accessibilityRole='button'
                accessibilityLabel='Open activity log'
                style={styles.link}
                onPress={() => router.push('/activity' as never)}
            >
                <Text style={styles.linkText}>Open activity log</Text>
                <ChevR size={11} color={colors['fg-soft']} />
            </Pressable>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        alignItems: 'center',
        gap: 14,
        paddingTop: 60,
        paddingHorizontal: 20,
    },
    glyphTile: {
        width: 64,
        height: 64,
        borderRadius: 4,
        borderWidth: 1,
        borderColor: 'rgba(94, 206, 72, 0.28)',
        backgroundColor: colors['accent-tint'],
        alignItems: 'center',
        justifyContent: 'center',
    },
    heading: {
        fontFamily: FontFamily.displaySemibold,
        fontSize: 18,
        lineHeight: 22,
        letterSpacing: -0.36,
        color: colors.fg,
    },
    sub: {
        fontFamily: FontFamily.sans,
        fontSize: 12,
        lineHeight: 17,
        color: colors['fg-muted'],
        maxWidth: 280,
        textAlign: 'center',
    },
    link: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        marginTop: 6,
    },
    linkText: {
        fontFamily: FontFamily.sansMedium,
        fontSize: 13,
        lineHeight: 13,
        color: colors['fg-soft'],
    },
});
