/**
 * Generates the Expo app icon set from the BrandGlyph SVG. One-off-ish:
 * regenerate with `bun --cwd=./app run icons` whenever the brand mark
 * changes. Outputs PNGs into `assets/images/`.
 *
 * Always invoked from the `app/` cwd (see the `icons` script in
 * package.json), so paths resolve relative to `process.cwd()`.
 */

import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import sharp from 'sharp';

import { renderBrandGlyphSvg } from './render-brand-glyph-svg';

// Canvas dark from `app/tailwind.config.ts` → `ink-50`. APP-38 pins the
// adaptive-icon background to this value.
const CANVAS_DARK = '#06090A';

const OUTPUT_DIR = resolve(process.cwd(), 'assets', 'images');

async function writePng(filename: string, svg: string): Promise<void> {
    const outPath = resolve(OUTPUT_DIR, filename);
    await mkdir(dirname(outPath), { recursive: true });
    await sharp(Buffer.from(svg)).png().toFile(outPath);
    console.log(`icons: wrote ${outPath}`);
}

async function main(): Promise<void> {
    const SIZE = 1024;

    // iOS full-bleed: canvas-dark background + glyph at ~62% (safe inside the
    // rounded-corner mask iOS applies at render time).
    await writePng('icon.png', renderBrandGlyphSvg({
        size: SIZE,
        background: CANVAS_DARK,
        padding: 0.38,
    }));

    // Android adaptive foreground: transparent, glyph at ~55% (well inside the
    // 66dp safe zone Android crops to under various launcher masks).
    await writePng('android-icon-foreground.png', renderBrandGlyphSvg({
        size: SIZE,
        background: null,
        padding: 0.45,
    }));

    // Android themed-icon monochrome: white-on-transparent silhouette.
    await writePng('android-icon-monochrome.png', renderBrandGlyphSvg({
        size: SIZE,
        background: null,
        padding: 0.45,
        color: '#FFFFFF',
    }));

    // Splash icon: transparent, glyph at ~80% (the splash plugin scales it
    // down at runtime via `imageWidth: 200`).
    await writePng('splash-icon.png', renderBrandGlyphSvg({
        size: SIZE,
        background: null,
        padding: 0.20,
    }));

    console.log('icons: done.');
}

await main().catch(err => {
    console.error('icons: build failed.', err);
    process.exit(1);
});
