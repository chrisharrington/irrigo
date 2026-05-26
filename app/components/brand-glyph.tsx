import Svg, { Ellipse, Path } from 'react-native-svg';

/**
 * Props for the Irrigo brand glyph (sprinkler arc + droplet + soil ellipse).
 * Colors are fixed brand artwork and not configurable.
 */
export type BrandGlyphProps = {
    /** Optional. Pixel size for the rendered square. Defaults to 28. */
    size?: number;

    /** Optional. Accessibility label. Defaults to `Irrigo`. */
    accessibilityLabel?: string;
};

const SOIL_FILL = '#1B231F';
const SOIL_STROKE = '#344239';
const ACCENT = '#5ece48';

/**
 * The Irrigo brand mark — a dashed sprinkler arc spraying down to a droplet
 * over a soil ellipse. Scales as a single 84×84 vector unit; pass `size`
 * to control the rendered square. Colors are fixed (matches the design
 * source); do not theme this glyph.
 */
export function BrandGlyph({ size = 28, accessibilityLabel = 'Irrigo' }: BrandGlyphProps) {
    return (
        <Svg width={size} height={size} viewBox='0 0 84 84' fill='none' accessibilityLabel={accessibilityLabel}>
            <Ellipse cx={42} cy={64} rx={32} ry={6} fill={SOIL_FILL} stroke={SOIL_STROKE} strokeWidth={1.2} />
            <Path d='M10 46 A 32 30 0 0 1 74 46' stroke={ACCENT} strokeWidth={2.4} strokeLinecap='round' fill='none' strokeDasharray='2.4 4' />
            <Path d='M42 46 L 42 60' stroke={ACCENT} strokeWidth={2.4} strokeLinecap='round' />
            <Path d='M42 22 C 36 30, 36 38, 42 40 C 48 38, 48 30, 42 22 Z' fill={ACCENT} />
        </Svg>
    );
}
