/**
 * Pure helper that renders an SVG document containing the BrandGlyph
 * markup, sized + padded to fit a square canvas. Lifted out of the icon-
 * build runner so test files can import it without dragging in Bun-only
 * APIs or filesystem effects.
 *
 * The BrandGlyph itself lives at `app/components/brand-glyph.tsx`; this
 * file copies the same path / ellipse markup so the script can run under
 * bare Node (or jest-expo via babel-jest) without pulling in the React
 * Native module graph.
 */

const SOIL_FILL = '#1B231F';
const SOIL_STROKE = '#344239';
const ACCENT = '#6FE39B';

/**
 * Renders a `size × size` SVG document containing the BrandGlyph centred
 * inside an inner safe zone. The glyph's native 84×84 viewBox is scaled
 * to fit `(1 - padding) × size` per side, centred via a translate.
 *
 * - `background`: hex fill for the outer canvas, or `null` for transparent.
 * - `color`: when provided, overrides every accent stroke + fill — used
 *   by the Android monochrome themed-icon variant.
 */
export function renderBrandGlyphSvg(opts: {
    size: number;
    background: string | null;
    padding: number;
    color?: string;
}): string {
    const { size, background, padding, color } = opts;
    const accent = color ?? ACCENT;
    const soilFill = color ?? SOIL_FILL;
    const soilStroke = color ?? SOIL_STROKE;

    const innerSize = size * (1 - padding);
    const offset = (size - innerSize) / 2;

    const backgroundRect = background === null
        ? ''
        : `<rect width="${size}" height="${size}" fill="${background}"/>`;

    return [
        `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" fill="none">`,
        backgroundRect,
        `<g transform="translate(${offset} ${offset}) scale(${innerSize / 84})">`,
        `<ellipse cx="42" cy="64" rx="32" ry="6" fill="${soilFill}" stroke="${soilStroke}" stroke-width="1.2"/>`,
        `<path d="M10 46 A 32 30 0 0 1 74 46" stroke="${accent}" stroke-width="2.4" stroke-linecap="round" fill="none" stroke-dasharray="2.4 4"/>`,
        `<path d="M42 46 L 42 60" stroke="${accent}" stroke-width="2.4" stroke-linecap="round"/>`,
        `<path d="M42 22 C 36 30, 36 38, 42 40 C 48 38, 48 30, 42 22 Z" fill="${accent}"/>`,
        `</g>`,
        `</svg>`,
    ].join('');
}
