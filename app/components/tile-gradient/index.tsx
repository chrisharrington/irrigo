import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

/**
 * Visual variant selecting the gradient's colour pair. `'elevated'` matches
 * the `colors.elevated` card surface (`#1B231F`); `'surface'` matches
 * `colors.surface` (`#0E1412`).
 */
export type TileGradientVariant = 'elevated' | 'surface';

/**
 * Opaque [top, bottom] colour pairs per variant. The bottom stop is the
 * base card colour nudged ~3% toward `grass-700` (#2C8F5A) so the gradient
 * reads as a subtle tint of the same surface, not a separate hue. APP-60.
 */
export const TILE_GRADIENT_COLORS: Readonly<Record<TileGradientVariant, readonly [string, string]>> = {
    elevated: ['#1B231F', '#1D2820'],
    surface: ['#0E1412', '#0F1612'],
};

const GRADIENT_START = { x: 0, y: 0 } as const;
const GRADIENT_END = { x: 0, y: 1 } as const;

/**
 * Props for the tile gradient wrapper.
 */
export type TileGradientProps = {
    /** Optional. Colour pair selector. Defaults to `'elevated'`. */
    variant?: TileGradientVariant;

    /** Optional. Style applied to the gradient view — typically the host card's border / padding / radius / shadow. */
    style?: StyleProp<ViewStyle>;

    /** Optional. Accessibility label forwarded to the underlying view. */
    accessibilityLabel?: string;

    /** Optional. Card contents. */
    children?: ReactNode;
};

/**
 * Thin wrapper around `<LinearGradient>` that supplies the standard
 * top-to-bottom direction and the per-variant colour stops used by every
 * Irrigo card surface. Forwards `style`, `accessibilityLabel`, and
 * children — callers continue to own border, padding, radius, gap, and
 * shadow. APP-60.
 */
export function TileGradient({ variant = 'elevated', style, accessibilityLabel, children }: TileGradientProps) {
    return (
        <LinearGradient
            colors={[...TILE_GRADIENT_COLORS[variant]]}
            start={GRADIENT_START}
            end={GRADIENT_END}
            style={style}
            accessibilityLabel={accessibilityLabel}
        >
            {children}
        </LinearGradient>
    );
}
