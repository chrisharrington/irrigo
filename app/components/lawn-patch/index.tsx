import Svg, { Path } from 'react-native-svg';

/**
 * Shape variant slug — picks one of three organic outlines so a viewer can
 * recognise a zone by its glyph independent of name or colour.
 */
export type LawnPatchSlug = 'a' | 'b' | 'c';

/**
 * Props for the per-zone lawn-patch glyph.
 */
export type LawnPatchProps = {
    /** Optional. Shape variant for tactile per-zone recognition. Defaults to `a`. */
    slug?: LawnPatchSlug;
    /** Optional. Pixel size for the rendered square. Defaults to 28. */
    size?: number;
    /** Optional. Stroke + fill colour (filled at 22% alpha, stroked at full). Defaults to the grass accent (#6FE39B). */
    tone?: string;
    /** Optional. Accessibility label for screen readers. Defaults to `Lawn patch`. */
    accessibilityLabel?: string;
};

const ACCENT = '#6FE39B';

export const OUTLINE_PATH: Readonly<Record<LawnPatchSlug, string>> = {
    a: 'M4 8 C 6 4, 14 4, 18 8 C 22 6, 28 10, 28 16 C 28 22, 22 28, 16 28 C 8 28, 3 22, 4 16 C 4 12, 3 10, 4 8 Z',
    b: 'M5 7 C 9 3, 22 4, 26 9 C 30 14, 28 22, 22 27 C 14 30, 6 26, 4 18 C 3 13, 4 10, 5 7 Z',
    c: 'M6 9 C 4 5, 14 3, 20 5 C 26 8, 30 14, 26 20 C 24 26, 16 30, 10 26 C 4 22, 4 14, 6 9 Z',
};

const BLADE_PATHS: readonly string[] = [
    'M8 12 l1 -2', 'M11 10 l1 -2', 'M14 12 l1 -2', 'M17 10 l1 -2', 'M20 12 l1 -2',
    'M9 16 l1 -2', 'M13 16 l1 -2', 'M17 16 l1 -2', 'M21 16 l1 -2',
    'M11 20 l1 -2', 'M15 20 l1 -2', 'M19 20 l1 -2',
];

/**
 * Per-zone lawn-patch glyph — a soft organic outline with grass-blade strokes
 * stencilled on top. Three shape variants (`a` / `b` / `c`) give each zone a
 * recognisable silhouette; tone is caller-controlled so the glyph can shift
 * from the grass accent to danger red when a zone is past RAW. RN port of
 * `LawnPatch` from the design system's `components.jsx`.
 */
export function LawnPatch({
    slug = 'a',
    size = 28,
    tone = ACCENT,
    accessibilityLabel = 'Lawn patch',
}: LawnPatchProps) {
    return (
        <Svg
            width={size}
            height={size}
            viewBox='0 0 32 32'
            fill='none'
            accessibilityLabel={accessibilityLabel}
        >
            <Path
                d={OUTLINE_PATH[slug]}
                fill={tone}
                fillOpacity={0.22}
                stroke={tone}
                strokeWidth={1.4}
            />
            {BLADE_PATHS.map(d => (
                <Path
                    key={d}
                    d={d}
                    stroke={tone}
                    strokeWidth={1.2}
                    strokeLinecap='round'
                    opacity={0.95}
                />
            ))}
        </Svg>
    );
}
