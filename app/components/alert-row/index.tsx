import { StyleSheet, Text, View } from 'react-native';

import { FontFamily } from '@/constants/fonts';
import config from '@/tailwind.config';

const colors = config.theme.extend.colors;

/**
 * Visual tone selecting the alert's tinted background, border, and icon
 * glyph. RN port of `.alert.alert--<tone>` from the design's `AlertRow`.
 */
export type AlertRowTone = 'info' | 'warn' | 'danger';

/**
 * Props for the Irrigo alert-row primitive.
 */
export type AlertRowProps = {
    /** Required. Visual tone — selects the tinted bg/border palette and icon glyph. */
    tone: AlertRowTone;

    /** Required. Title text. */
    title: string;

    /** Optional. Sub-line text rendered under the title. */
    sub?: string;

    /** Optional. Relative-time slot rendered on the right (e.g. `'11h'`, `'2d'`). */
    when?: string;

    /** Optional. Accessibility label for the row. Defaults to title + sub joined by a period. */
    accessibilityLabel?: string;
};

type TonePalette = {
    background: string;
    border: string;
    accent: string;
    icon: string;
};

const TONE_PALETTE: Readonly<Record<AlertRowTone, TonePalette>> = {
    info: {
        background: colors['info-tint'],
        border: colors['info-border'],
        accent: colors.info,
        icon: 'i',
    },
    warn: {
        background: colors['warn-tint'],
        border: colors['warn-border'],
        accent: colors.warn,
        icon: '⚠',
    },
    danger: {
        background: colors['danger-tint'],
        border: colors['danger-border'],
        accent: colors.danger,
        icon: '!',
    },
};

/**
 * The Irrigo alert-row — surfaces a single tonight-or-recent failure in the
 * alerts/activity feed. Icon glyph (left), title + optional sub (middle),
 * optional relative-time slot (right). Tinted background and border per
 * tone; title and icon paint in the tone's full color, sub paints in
 * `fg-soft`. RN port of `AlertRow` from `components.jsx`.
 */
export function AlertRow({
    tone,
    title,
    sub,
    when,
    accessibilityLabel,
}: AlertRowProps) {
    const palette = TONE_PALETTE[tone];
    const label = accessibilityLabel ?? (sub ? `${title}. ${sub}` : title);

    return (
        <View
            accessibilityLabel={label}
            style={[
                styles.container,
                { backgroundColor: palette.background, borderColor: palette.border },
            ]}
        >
            <View style={[styles.iconBadge, { backgroundColor: palette.background }]}>
                <Text style={[styles.iconText, { color: palette.accent }]}>{palette.icon}</Text>
            </View>

            <View style={styles.body}>
                <Text style={[styles.title, { color: palette.accent }]}>{title}</Text>
                {sub !== undefined && <Text style={styles.sub}>{sub}</Text>}
            </View>

            {when !== undefined && <Text style={styles.when}>{when}</Text>}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        padding: 12,
        borderWidth: 1,
        borderRadius: 4,
    },
    iconBadge: {
        width: 24,
        height: 24,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
    },
    iconText: {
        fontFamily: FontFamily.sansSemibold,
        fontSize: 14,
        lineHeight: 14,
    },
    body: {
        flex: 1,
        gap: 2,
    },
    title: {
        fontFamily: FontFamily.sansMedium,
        fontSize: 14,
        lineHeight: 18,
    },
    sub: {
        fontFamily: FontFamily.sans,
        fontSize: 12,
        lineHeight: 16,
        color: colors['fg-soft'],
    },
    when: {
        fontFamily: FontFamily.monoMedium,
        fontSize: 12,
        lineHeight: 14,
        color: colors['fg-muted'],
        flexShrink: 0,
    },
});
