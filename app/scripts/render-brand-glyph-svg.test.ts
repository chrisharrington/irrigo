/**
 * @jest-environment node
 */

import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';

import { renderBrandGlyphSvg } from './render-brand-glyph-svg';

const ASSETS = resolve(__dirname, '..', 'assets', 'images');

describe('renderBrandGlyphSvg', () => {
    it('returns an SVG document of the requested square dimensions.', () => {
        const svg = renderBrandGlyphSvg({ size: 1024, background: '#06090A', padding: 0.38 });

        expect(svg).toMatch(/^<svg /);
        expect(svg).toContain('width="1024"');
        expect(svg).toContain('height="1024"');
        expect(svg).toContain('viewBox="0 0 1024 1024"');
    });

    it('includes the BrandGlyph droplet, sprinkler arc, and soil ellipse markup.', () => {
        const svg = renderBrandGlyphSvg({ size: 1024, background: null, padding: 0.45 });

        expect(svg).toContain('M42 22 C 36 30, 36 38, 42 40 C 48 38, 48 30, 42 22 Z');
        expect(svg).toContain('M10 46 A 32 30 0 0 1 74 46');
        expect(svg).toContain('<ellipse cx="42" cy="64"');
    });

    it('renders the background rect when a colour is supplied and omits it when transparent.', () => {
        const opaque = renderBrandGlyphSvg({ size: 1024, background: '#06090A', padding: 0.38 });
        const transparent = renderBrandGlyphSvg({ size: 1024, background: null, padding: 0.38 });

        expect(opaque).toContain('<rect width="1024" height="1024" fill="#06090A"/>');
        expect(transparent).not.toContain('<rect ');
    });

    it('recolours every glyph fill / stroke when an override colour is supplied (monochrome variant).', () => {
        const svg = renderBrandGlyphSvg({ size: 1024, background: null, padding: 0.45, color: '#FFFFFF' });

        // Brand colours from the BrandGlyph component must NOT appear when an
        // override is in force.
        expect(svg).not.toContain('#6FE39B');
        expect(svg).not.toContain('#1B231F');
        expect(svg).not.toContain('#344239');
        // The override colour shows up on the droplet fill, both stroke paths,
        // and the soil ellipse — at least four occurrences.
        const occurrences = svg.match(/#FFFFFF/g) ?? [];
        expect(occurrences.length).toBeGreaterThanOrEqual(4);
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
