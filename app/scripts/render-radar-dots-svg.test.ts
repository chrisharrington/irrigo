/**
 * @jest-environment node
 */

import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';

import { renderRadarDotsSvg } from './render-radar-dots-svg';

const ASSETS = resolve(__dirname, '..', 'assets', 'images');

// The mark in `L02_Spray` (app/design/logos/logos.jsx) has 5+7+9 = 21 dots
// across three arcs, plus a single 4×4 anchor rect at the base.
const EXPECTED_DOT_COUNT = 21;

describe('renderRadarDotsSvg', () => {
    it('returns an SVG document of the requested square dimensions.', () => {
        const svg = renderRadarDotsSvg({ size: 1024, background: '#06090A', padding: 0.38 });

        expect(svg).toMatch(/^<svg /);
        expect(svg).toContain('width="1024"');
        expect(svg).toContain('height="1024"');
        expect(svg).toContain('viewBox="0 0 1024 1024"');
    });

    it('renders the bottom anchor rect plus 21 arc dots (5 + 7 + 9) matching the design source.', () => {
        const svg = renderRadarDotsSvg({ size: 1024, background: null, padding: 0.45 });

        // Anchor: 4×4 rect at the design-source coordinates `x=30 y=48`.
        expect(svg).toContain('<rect x="30" y="48" width="4" height="4"');

        // Dots: 21 circles, no more, no less.
        const dotMatches = svg.match(/<circle /g) ?? [];
        expect(dotMatches).toHaveLength(EXPECTED_DOT_COUNT);
    });

    it('fades outer arcs via decreasing opacity (inner = 1.0, middle ≈ 0.8, outer ≈ 0.6).', () => {
        const svg = renderRadarDotsSvg({ size: 1024, background: null, padding: 0.45 });

        // Expected opacities per arc (per `0.4 + 0.6 * (1 - ai / 3)`).
        expect(svg).toContain('opacity="1"');                  // inner arc
        expect(svg).toMatch(/opacity="0\.8\b/);                // middle arc
        expect(svg).toMatch(/opacity="0\.6\b/);                // outer arc
    });

    it('renders the background rect when a colour is supplied and omits it when transparent.', () => {
        const opaque = renderRadarDotsSvg({ size: 1024, background: '#06090A', padding: 0.38 });
        const transparent = renderRadarDotsSvg({ size: 1024, background: null, padding: 0.38 });

        // Opaque variant: a background rect spans the full 1024×1024 canvas.
        expect(opaque).toContain('<rect width="1024" height="1024" fill="#06090A"/>');
        // Transparent variant: the only rect should be the small 4×4 anchor.
        const opaqueRects = opaque.match(/<rect /g) ?? [];
        const transparentRects = transparent.match(/<rect /g) ?? [];
        expect(opaqueRects).toHaveLength(2);
        expect(transparentRects).toHaveLength(1);
    });

    it('recolours every fill when an override colour is supplied (monochrome variant).', () => {
        const svg = renderRadarDotsSvg({ size: 1024, background: null, padding: 0.45, color: '#FFFFFF' });

        // The design-source accent must not appear when an override is set.
        expect(svg).not.toContain('#5ece48');
        // The override colour shows up on the anchor rect plus every dot.
        const occurrences = svg.match(/#FFFFFF/g) ?? [];
        expect(occurrences.length).toBe(EXPECTED_DOT_COUNT + 1);
    });
});

describe('committed icon PNGs', () => {
    type IconCase = { file: string; width: number; height: number };

    const ICONS: ReadonlyArray<IconCase> = [
        { file: 'icon.png', width: 1024, height: 1024 },
        { file: 'android-icon-foreground.png', width: 1024, height: 1024 },
        { file: 'android-icon-monochrome.png', width: 1024, height: 1024 },
        { file: 'splash-icon.png', width: 1024, height: 1024 },
    ];

    it.each(ICONS)('$file exists and is $width x $height.', async ({ file, width, height }) => {
        const path = resolve(ASSETS, file);
        // File must exist (statSync throws if not).
        expect(statSync(path).size).toBeGreaterThan(0);

        const meta = await sharp(path).metadata();
        expect(meta.width).toBe(width);
        expect(meta.height).toBe(height);
    });
});
