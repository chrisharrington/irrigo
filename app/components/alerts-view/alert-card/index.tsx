import { StyleSheet, Text, View } from 'react-native';

import type { AlertDto, AlertTone } from '@/api/types/alerts';
import { FontFamily } from '@/constants/fonts';
import config from '@/tailwind.config';
import { formatAlertTimestamp, KIND_LABEL } from '../bucketing';

const colors = config.theme.extend.colors;

type TonePalette = {
    // Full-strength tone colour for the left strip, kind tag, and unread dot.
    accent: string;

    // Faint tone wash painted behind unread cards only.
    tint: string;
};

// Tone palette keyed by the wire's two tones. The mock's `info` tier has no
// wire class today (every alert is warn-or-worse), so it is intentionally
// absent — see the AlertsView wire-model notes.
const TONE_PALETTE: Readonly<Record<AlertTone, TonePalette>> = {
    warn: { accent: colors.warn, tint: 'rgba(255, 190, 107, 0.05)' },
    danger: { accent: colors.danger, tint: 'rgba(255, 107, 123, 0.06)' },
};

/**
 * Props for the alert card.
 */
export type AlertCardProps = {
    /** Required. The alert to render. */
    alert: AlertDto;

    /** Required. "Now" anchor used to format the timestamp. */
    now: Date;

    /** Required. IANA timezone the site clock runs in. */
    timezone: string;
};

/**
 * A single alert row on the Alerts screen. RN port of the mock's `AlertCard`
 * ([`Alerts.jsx`](app/design/ui_kit/Alerts.jsx)): a 3px left tone strip, a
 * kind tag derived from the wire `class`, a monospace site-local timestamp
 * with an unread dot, the title (brighter when unread), and the body sub-
 * text. Unread cards (`!ack`) get a tone-tinted background wash.
 *
 * Non-interactive — there is no per-alert detail surface today — but carries
 * an accessibility label of the title plus sub for screen readers.
 */
export function AlertCard({ alert, now, timezone }: AlertCardProps) {
    const unread = !alert.ack,
        palette = TONE_PALETTE[alert.tone],
        kind = KIND_LABEL[alert.class],
        timestamp = formatAlertTimestamp(alert.when, now, timezone),
        label = alert.sub !== null ? `${alert.title}. ${alert.sub}` : alert.title;

    return (
        <View
            accessibilityLabel={label}
            style={[
                styles.card,
                { borderLeftColor: palette.accent },
                unread ? { backgroundColor: palette.tint } : null,
            ]}
        >
            {/* Kind tag + timestamp + unread dot. */}
            <View style={styles.topRow}>
                <Text style={[styles.kind, { color: palette.accent }]}>{kind}</Text>
                <View style={styles.timeSlot}>
                    <Text style={styles.time}>{timestamp}</Text>
                    {unread && (
                        <View
                            accessibilityLabel='Unread alert'
                            style={[styles.dot, { backgroundColor: palette.accent }]}
                        />
                    )}
                </View>
            </View>

            {/* Title. */}
            <Text style={[styles.title, { color: unread ? colors.fg : colors['fg-soft'] }]}>
                {alert.title}
            </Text>

            {/* Body sub-text. */}
            {alert.sub !== null && <Text style={styles.sub}>{alert.sub}</Text>}
        </View>
    );
}

const styles = StyleSheet.create({
    card: {
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
        borderLeftWidth: 3,
        borderRadius: 4,
        paddingVertical: 12,
        paddingHorizontal: 14,
    },
    topRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 6,
    },
    kind: {
        fontFamily: FontFamily.monoMedium,
        fontSize: 10,
        lineHeight: 10,
        letterSpacing: 1.2,
    },
    timeSlot: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    time: {
        fontFamily: FontFamily.monoMedium,
        fontSize: 11,
        lineHeight: 11,
        color: colors['fg-dim'],
    },
    dot: {
        width: 6,
        height: 6,
    },
    title: {
        fontFamily: FontFamily.displaySemibold,
        fontSize: 15,
        lineHeight: 18,
        letterSpacing: -0.225,
    },
    sub: {
        fontFamily: FontFamily.sans,
        fontSize: 12,
        lineHeight: 17,
        color: colors['fg-muted'],
        marginTop: 5,
    },
});
