/**
 * Pure helper that renders an SVG document of the "radar dots" Irrigo
 * mark — three concentric dotted arcs fanning ~140° upward from a center-
 * bottom anchor. Ported faithfully from `L02_Spray` in
 * `app/design/logos/logos.jsx`, minus the decorative drop-shadow glow
 * (which doesn't survive PNG rasterization at icon sizes).
 *
 * Lifted out of the icon-build runner so tests can import without
 * dragging in Bun-only APIs or filesystem effects.
 */

const ACCENT = '#6FE39B';

// 64-unit viewBox + center-bottom anchor exactly as the design source
// specifies (`anchor` at `x=30 y=48` 4×4; arc origin `(32, 50)`).
const VIEWBOX = 64;
const ANCHOR_X = 32;
const ANCHOR_Y = 50;
const SPREAD_RADIANS = Math.PI * 0.78; // ~140°
const ARCS: ReadonlyArray<{ r: number; dots: number }> = [
    { r: 14, dots: 5 },
    { r: 22, dots: 7 },
    { r: 30, dots: 9 },
];
const DOT_RADIUS = 1.4;

/**
 * Per-arc opacity, mirroring `op = 0.4 + 0.6 * (1 - ai / arcs.length)` in
 * the design source. Inner arc is fully opaque; outer arcs fade so the
 * mark reads as a broadcast pattern.
 */
function opacityForArcIndex(arcIndex: number): number {
    // Round to 2 decimals so floating-point drift doesn't leak into the
    // serialised SVG (`0.6000000000000001` etc.).
    const raw = 0.4 + 0.6 * (1 - arcIndex / ARCS.length);
    return Math.round(raw * 100) / 100;
}

/**
 * Renders a `size × size` SVG document containing the radar-dots mark
 * centred inside an inner safe zone. The 64-unit viewBox is scaled to
 * fit `(1 - padding) × size` per side, centred via a translate.
 *
 * - `background`: hex fill for the outer canvas, or `null` for transparent.
 * - `color`: when provided, overrides the accent — used by the Android
 *   monochrome themed-icon variant (white silhouette).
 */
export function renderRadarDotsSvg(opts: {
    size: number;
    background: string | null;
    padding: number;
    color?: string;
}): string {
    const { size, background, padding, color } = opts;
    const fill = color ?? ACCENT;

    const innerSize = size * (1 - padding);
    const offset = (size - innerSize) / 2;
    const scale = innerSize / VIEWBOX;

    const backgroundRect = background === null
        ? ''
        : `<rect width="${size}" height="${size}" fill="${background}"/>`;

    const dots: string[] = [];
    ARCS.forEach((arc, arcIndex) => {
        const opacity = opacityForArcIndex(arcIndex);
        const start = -Math.PI / 2 - SPREAD_RADIANS / 2;
        for (let i = 0; i < arc.dots; i++) {
            const t = i / (arc.dots - 1);
            const a = start + SPREAD_RADIANS * t;
            const cx = ANCHOR_X + Math.cos(a) * arc.r;
            const cy = ANCHOR_Y + Math.sin(a) * arc.r;
            dots.push(
                `<circle cx="${cx.toFixed(4)}" cy="${cy.toFixed(4)}" r="${DOT_RADIUS}" fill="${fill}" opacity="${opacity}"/>`,
            );
        }
    });

    return [
        `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" fill="none">`,
        backgroundRect,
        `<g transform="translate(${offset} ${offset}) scale(${scale})">`,
        `<rect x="30" y="48" width="4" height="4" fill="${fill}"/>`,
        ...dots,
        `</g>`,
        `</svg>`,
    ].join('');
}
