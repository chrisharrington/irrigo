import type { PropsWithChildren } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

const tailwindConfig = require('../tailwind.config.js') as {
    theme: { extend: { colors: Record<string, string> } };
};
const colors = tailwindConfig.theme.extend.colors;

/**
 * Props for the Irrigo canvas background.
 */
export type CanvasBackgroundProps = PropsWithChildren<{
    /** Optional. Accessibility label for the canvas root. Defaults to `Irrigo canvas`. */
    accessibilityLabel?: string;
}>;

const BACKGROUND_COLOR = colors.bg;
// Soft canvas-backdrop tints shared with the modal scrim (grass-glow-3) and
// info-tinted surfaces (water-glow). See `tailwind.config.js`.
const GREEN_GLOW = colors['grass-glow-3'];
const BLUE_GLOW = colors['water-glow'];

const GREEN_GRADIENT_ID = 'irrigoCanvasGreenGlow';
const BLUE_GRADIENT_ID = 'irrigoCanvasBlueGlow';

/**
 * The Irrigo dark canvas backdrop — `#06090A` base painted under two soft
 * radial gradients (green at top-left, blue at mid-right) that mirror the
 * `ui_kit/index.html` canvas recipe from the design source. The gradient
 * SVG is positioned absolutely behind children and ignores touches so it
 * never intercepts taps.
 */
export function CanvasBackground({ accessibilityLabel = 'Irrigo canvas', children }: CanvasBackgroundProps) {
    return (
        <View style={styles.canvas} accessibilityLabel={accessibilityLabel}>
            <Svg style={StyleSheet.absoluteFill} width='100%' height='100%' pointerEvents='none'>
                <Defs>
                    <RadialGradient id={GREEN_GRADIENT_ID} cx='20%' cy='-5%' r='50%' fx='20%' fy='-5%'>
                        <Stop offset='0%' stopColor={GREEN_GLOW} />
                        <Stop offset='100%' stopColor={GREEN_GLOW} stopOpacity={0} />
                    </RadialGradient>
                    <RadialGradient id={BLUE_GRADIENT_ID} cx='90%' cy='50%' r='50%' fx='90%' fy='50%'>
                        <Stop offset='0%' stopColor={BLUE_GLOW} />
                        <Stop offset='100%' stopColor={BLUE_GLOW} stopOpacity={0} />
                    </RadialGradient>
                </Defs>
                <Rect width='100%' height='100%' fill={`url(#${GREEN_GRADIENT_ID})`} />
                <Rect width='100%' height='100%' fill={`url(#${BLUE_GRADIENT_ID})`} />
            </Svg>
            <View style={styles.content}>{children}</View>
        </View>
    );
}

const styles = StyleSheet.create({
    canvas: {
        flex: 1,
        backgroundColor: BACKGROUND_COLOR,
    },
    content: {
        flex: 1,
    },
});
