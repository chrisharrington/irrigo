import { StyleSheet, Text, View, type ViewStyle, type TextStyle } from 'react-native';

import { FontFamily } from '../../constants/fonts';

const tailwindConfig = require('../../tailwind.config.js') as {
    theme: { extend: { colors: Record<string, string> } };
};
const colors = tailwindConfig.theme.extend.colors;

/**
 * Visual tone selecting the badge's color, border tint, background tint, and
 * dot color. RN port of the `.badge--<tone>` modifiers in the design CSS.
 */
export type BadgeTone = 'neutral' | 'active' | 'warn' | 'danger' | 'info';

/**
 * Props for the Irrigo badge primitive.
 */
export type BadgeProps = {
    /** Optional. Visual tone — selects color, border, and dot palette. Defaults to `neutral`. */
    tone?: BadgeTone;
    /** Optional. Show the colored dot prefix. Defaults to `true`. */
    dot?: boolean;
    /** Required. Badge label text. */
    children: string;
};

type TonePalette = {
    text: string;
    border: string;
    background: string;
    dot: string;
};

const TONE_PALETTE: Readonly<Record<BadgeTone, TonePalette>> = {
    neutral: {
        text: colors['fg-soft'],
        border: colors.border,
        background: colors.surface,
        dot: colors['fg-muted'],
    },
    active: {
        text: colors.accent,
        border: colors['accent-border'],
        background: colors['accent-tint'],
        dot: colors.accent,
    },
    warn: {
        text: colors.warn,
        border: colors['warn-border'],
        background: colors['warn-tint'],
        dot: colors.warn,
    },
    danger: {
        text: colors.danger,
        border: colors['danger-border'],
        background: colors['danger-tint'],
        dot: colors.danger,
    },
    info: {
        text: colors.info,
        border: colors['info-border'],
        background: colors['info-tint'],
        dot: colors.info,
    },
};

/**
 * Irrigo badge primitive — a small 22px-tall tag that labels state with a
 * tinted background, border, dot, and label color per tone. RN port of
 * `Badge` from the design system's `components.jsx`.
 */
export function Badge({ tone = 'neutral', dot = true, children }: BadgeProps) {
    const palette = TONE_PALETTE[tone];

    const containerStyle: ViewStyle = {
        ...styles.container,
        backgroundColor: palette.background,
        borderColor: palette.border,
    };

    const textStyle: TextStyle = {
        ...styles.text,
        color: palette.text,
    };

    const dotStyle: ViewStyle = {
        ...styles.dot,
        backgroundColor: palette.dot,
        // Source `.badge--active .dot` carries a green glow. RN 0.81+ accepts
        // CSS-style `boxShadow` strings, so the design intent translates
        // verbatim. Other tones leave the shadow off.
        ...(tone === 'active'
            ? { boxShadow: `0 0 8px ${colors.accent}` }
            : {}),
    };

    return (
        <View style={containerStyle} accessibilityRole='text' accessibilityLabel={children}>
            {dot && <View style={dotStyle} />}
            <Text style={textStyle}>{children}</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        gap: 6,
        height: 22,
        paddingHorizontal: 10,
        borderWidth: 1,
        borderRadius: 4,
    },
    dot: {
        width: 6,
        height: 6,
        borderRadius: 4,
    },
    text: {
        fontFamily: FontFamily.sansMedium,
        fontSize: 11,
        lineHeight: 11,
        letterSpacing: 0.11,
    },
});
