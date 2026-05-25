import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import type { ReactNode } from 'react';

import { TileGradient } from '@/components/tile-gradient';
import config from '@/tailwind.config';

const colors = config.theme.extend.colors;
const shadows = config.theme.extend.boxShadow;

/**
 * Visual variant selecting the card's gradient, padding, radius, and base
 * shadow. RN port of `.card-surface` / `.card-elev` in the design CSS.
 * `TileGradient` paints the variant's subtle green-tinted gradient in place
 * of the design source's flat fill (APP-60).
 */
export type CardVariant = 'surface' | 'elevated';

/**
 * Props for the Irrigo card primitive.
 */
export type CardProps = {
    /** Optional. Visual variant — selects bg, radius, padding, and base shadow. Defaults to `surface`. */
    variant?: CardVariant;
    /** Optional. Add the accent-glow ring on top of the base shadow. Defaults to `false`. */
    glow?: boolean;
    /** Optional. Style overrides merged onto the container. */
    style?: StyleProp<ViewStyle>;
    /** Required. Card contents. */
    children: ReactNode;
};

type VariantStyle = {
    padding: number;
    borderRadius: number;
    boxShadow?: string;
};

const VARIANT_STYLE: Readonly<Record<CardVariant, VariantStyle>> = {
    surface: {
        padding: 16,
        borderRadius: 4,
    },
    elevated: {
        padding: 20,
        borderRadius: 4,
        boxShadow: shadows['2'],
    },
};

/**
 * Irrigo card primitive — a bordered container with surface / elevated tones
 * and an optional accent-glow ring. RN port of `.card-surface` / `.card-elev`
 * from `components.css`.
 */
export function Card({ variant = 'surface', glow = false, style, children }: CardProps) {
    const variantStyle = VARIANT_STYLE[variant];

    // Compose the base shadow (if any) with the accent-glow ring when `glow`
    // is on. RN 0.81+ accepts CSS-style `boxShadow` strings, so a comma-joined
    // string layers the two shadows the same way the source CSS does.
    const baseShadow = variantStyle.boxShadow;
    const glowShadow = shadows['glow-accent'];
    const boxShadow = glow
        ? baseShadow
            ? `${baseShadow}, ${glowShadow}`
            : glowShadow
        : baseShadow;

    const containerStyle: ViewStyle = {
        ...styles.container,
        padding: variantStyle.padding,
        borderRadius: variantStyle.borderRadius,
        ...(boxShadow ? { boxShadow } : {}),
    };

    return (
        <TileGradient variant={variant} style={[containerStyle, style]}>
            {children}
        </TileGradient>
    );
}

const styles = StyleSheet.create({
    container: {
        borderWidth: 1,
        borderColor: colors.border,
    },
});
