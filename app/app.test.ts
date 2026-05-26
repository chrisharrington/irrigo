/**
 * @jest-environment node
 *
 * Lock in the Expo app.json icon configuration. APP-38 swapped the
 * Android adaptive-icon background from the placeholder light blue to the
 * canvas dark token, dropped the placeholder backgroundImage in favour of
 * a solid colour, and points every asset path at the regenerated BrandGlyph
 * PNGs. These tests guard against accidental regression of that wiring.
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import appJson from './app.json';

type SplashPluginConfig = {
    image: string;
    imageWidth: number;
    resizeMode: string;
    backgroundColor: string;
    dark?: { backgroundColor: string };
};

function findSplashPlugin(): SplashPluginConfig {
    const plugins = appJson.expo.plugins;
    for (const entry of plugins) {
        if (Array.isArray(entry) && entry[0] === 'expo-splash-screen') {
            return entry[1] as SplashPluginConfig;
        }
    }
    throw new Error('expo-splash-screen plugin not configured in app.json');
}

describe('app.json icon configuration', () => {
    it('pins the Android adaptive-icon background to the canvas-dark design token (#06090A).', () => {
        expect(appJson.expo.android.adaptiveIcon.backgroundColor).toBe('#06090A');
    });

    it('uses a solid background colour for the Android adaptive icon (no backgroundImage).', () => {
        // The placeholder backgroundImage path was removed in APP-38 — the
        // ticket calls for a solid colour, not a custom background bitmap.
        expect((appJson.expo.android.adaptiveIcon as { backgroundImage?: string }).backgroundImage).toBeUndefined();
    });

    it('points every icon asset path at a file that exists in the repo.', () => {
        const projectRoot = __dirname;
        const candidates: ReadonlyArray<string> = [
            appJson.expo.icon,
            appJson.expo.android.adaptiveIcon.foregroundImage,
            appJson.expo.android.adaptiveIcon.monochromeImage,
            findSplashPlugin().image,
        ];

        for (const relativePath of candidates) {
            // Paths in app.json are written like './assets/images/icon.png'.
            const absolute = resolve(projectRoot, relativePath);
            expect(existsSync(absolute)).toBe(true);
        }
    });
});
