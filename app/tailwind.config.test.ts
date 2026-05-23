import type { Config, PluginAPI } from 'tailwindcss/types/config';

const config = require('./tailwind.config.js') as Config;

const theme = (config.theme?.extend ?? {}) as Record<string, Record<string, unknown>>;

type ComponentDeclarations = Readonly<Record<string, Readonly<Record<string, string>>>>;

const collectComponents = (): ComponentDeclarations => {
    const plugins = config.plugins ?? [];
    const collected: Record<string, Record<string, string>> = {};

    for (const entry of plugins) {
        const handler = (entry as { handler?: PluginAPI['addComponents'] extends never ? never : (api: PluginAPI) => void }).handler;
        if (typeof handler !== 'function') continue;
        handler({
            addComponents: (components: unknown) => {
                Object.assign(collected, components as Record<string, Record<string, string>>);
            },
        } as unknown as PluginAPI);
    }

    return collected;
};

describe('tailwind.config.js — Irrigo design tokens', () => {
    describe('colors', () => {
        const colors = theme.colors as Record<string, string>;

        it('exposes the raw ink ramp from canvas to divider.', () => {
            expect(colors['ink-50']).toBe('#06090A');
            expect(colors['ink-200']).toBe('#0E1412');
            expect(colors['ink-500']).toBe('#232E29');
            expect(colors['ink-700']).toBe('#495A50');
        });

        it('exposes the chalk ramp from fg to fg-faint.', () => {
            expect(colors['chalk-50']).toBe('#ECF1ED');
            expect(colors['chalk-400']).toBe('#8A9690');
            expect(colors['chalk-800']).toBe('#3A4641');
        });

        it('exposes the grass ramp plus glow rgba accents.', () => {
            expect(colors['grass-500']).toBe('#6FE39B');
            expect(colors['grass-700']).toBe('#2C8F5A');
            expect(colors['grass-glow']).toBe('rgba(111, 227, 155, 0.18)');
        });

        it('exposes the soft-glow tints used by canvas, modal, and info surfaces.', () => {
            expect(colors['grass-glow-2']).toBe('rgba(111, 227, 155, 0.06)');
            expect(colors['grass-glow-3']).toBe('rgba(111, 227, 155, 0.07)');
            expect(colors['water-glow']).toBe('rgba(124, 212, 251, 0.04)');
        });

        it('exposes the accent-supplemental ramps (water / amber / rose / moon).', () => {
            expect(colors['water-500']).toBe('#7CD4FB');
            expect(colors['amber-500']).toBe('#FFBE6B');
            expect(colors['rose-500']).toBe('#FF6B7B');
            expect(colors['moon-500']).toBe('#D8C690');
        });

        it('maps semantic aliases (bg, surface, fg, accent) to the matching raw hex.', () => {
            expect(colors.bg).toBe('#06090A');
            expect(colors.surface).toBe('#0E1412');
            expect(colors.fg).toBe('#ECF1ED');
            expect(colors['fg-soft']).toBe('#C7CFC9');
            expect(colors.accent).toBe('#6FE39B');
            expect(colors['accent-press']).toBe('#4FCB7E');
        });

        it('exposes warn / danger / info semantics plus on-accent for green buttons.', () => {
            expect(colors.warn).toBe('#FFBE6B');
            expect(colors.danger).toBe('#FF6B7B');
            expect(colors.info).toBe('#7CD4FB');
            expect(colors['on-accent']).toBe('#052013');
        });

        it('exposes the modal / sheet scrim at the design-spec alpha.', () => {
            expect(colors.scrim).toBe('rgba(2, 4, 3, 0.66)');
        });

        it('exposes tinted border / fill aliases (0.4 / 0.06 alpha) per semantic tone for tag-style chrome.', () => {
            expect(colors['accent-border']).toBe('rgba(111, 227, 155, 0.4)');
            expect(colors['accent-tint']).toBe('rgba(111, 227, 155, 0.06)');
            expect(colors['warn-border']).toBe('rgba(255, 190, 107, 0.4)');
            expect(colors['warn-tint']).toBe('rgba(255, 190, 107, 0.06)');
            expect(colors['danger-border']).toBe('rgba(255, 107, 123, 0.4)');
            expect(colors['danger-tint']).toBe('rgba(255, 107, 123, 0.06)');
            expect(colors['info-border']).toBe('rgba(124, 212, 251, 0.4)');
            expect(colors['info-tint']).toBe('rgba(124, 212, 251, 0.06)');
        });

        it('exposes the seven-stop depletion ramp end-to-end.', () => {
            expect(colors['depletion-0']).toBe('#6FE39B');
            expect(colors['depletion-3']).toBe('#E9C96D');
            expect(colors['depletion-6']).toBe('#FF6B7B');
        });
    });

    describe('spacing (4px grid)', () => {
        const spacing = theme.spacing as Record<string, string>;

        it('walks the 4px grid from s-1 (4px) up through s-12 (96px).', () => {
            expect(spacing['s-1']).toBe('4px');
            expect(spacing['s-4']).toBe('16px');
            expect(spacing['s-5']).toBe('20px');
            expect(spacing['s-6']).toBe('24px');
            expect(spacing['s-12']).toBe('96px');
        });
    });

    describe('borderRadius', () => {
        const radii = theme.borderRadius as Record<string, string>;

        it('resolves r-1 through r-5 and r-pill all to 4px (alias-now, soften-later).', () => {
            expect(radii['r-1']).toBe('4px');
            expect(radii['r-2']).toBe('4px');
            expect(radii['r-3']).toBe('4px');
            expect(radii['r-4']).toBe('4px');
            expect(radii['r-5']).toBe('4px');
            expect(radii['r-pill']).toBe('4px');
        });
    });

    describe('boxShadow', () => {
        const shadows = theme.boxShadow as Record<string, string>;

        it('exposes shadow ramps 1 / 2 / 3 with inset highlights and outer ambient.', () => {
            expect(shadows[1]).toContain('inset');
            expect(shadows[2]).toContain('rgba(0, 0, 0, 0.45)');
            expect(shadows[3]).toContain('rgba(0, 0, 0, 0.6)');
        });

        it('exposes glow-accent with the grass-tinted inset ring and outer glow.', () => {
            expect(shadows['glow-accent']).toContain('rgba(111, 227, 155, 0.28)');
            expect(shadows['glow-accent']).toContain('rgba(111, 227, 155, 0.18)');
        });
    });

    describe('typography (theme)', () => {
        const fontFamily = theme.fontFamily as Record<string, readonly string[]>;
        const fontSize = theme.fontSize as Record<string, readonly [string, Record<string, string>]>;

        it('declares the three brand families at their default (regular) weight.', () => {
            expect(fontFamily.display[0]).toBe('BricolageGrotesque_400Regular');
            expect(fontFamily.sans[0]).toBe('Geist_400Regular');
            expect(fontFamily.mono[0]).toBe('GeistMono_400Regular');
        });

        it('exposes weight-specific aliases for each family (one Tailwind token per loaded weight).', () => {
            expect(fontFamily['display-medium'][0]).toBe('BricolageGrotesque_500Medium');
            expect(fontFamily['display-semibold'][0]).toBe('BricolageGrotesque_600SemiBold');
            expect(fontFamily['display-bold'][0]).toBe('BricolageGrotesque_700Bold');
            expect(fontFamily['sans-light'][0]).toBe('Geist_300Light');
            expect(fontFamily['sans-medium'][0]).toBe('Geist_500Medium');
            expect(fontFamily['sans-semibold'][0]).toBe('Geist_600SemiBold');
            expect(fontFamily['sans-bold'][0]).toBe('Geist_700Bold');
            expect(fontFamily['mono-medium'][0]).toBe('GeistMono_500Medium');
            expect(fontFamily['mono-semibold'][0]).toBe('GeistMono_600SemiBold');
        });

        it('exposes the display ramp top (display-1) at 56px.', () => {
            expect(fontSize['display-1'][0]).toBe('56px');
            expect(fontSize['display-1'][1].lineHeight).toBe('0.96');
            expect(fontSize['display-1'][1].letterSpacing).toBe('-0.02em');
        });

        it('exposes the body and numeric scales used for runtimes / mm / time columns.', () => {
            expect(fontSize.body[0]).toBe('14px');
            expect(fontSize['num-hero'][0]).toBe('72px');
            expect(fontSize['num-sm'][0]).toBe('11px');
        });

        it('exposes the eyebrow label with uppercase-friendly letter-spacing.', () => {
            expect(fontSize.eyebrow[0]).toBe('11px');
            expect(fontSize.eyebrow[1].letterSpacing).toBe('0.14em');
        });
    });

    describe('typography (component classes via plugin)', () => {
        const components = collectComponents();

        it('emits display-1 with the Bricolage Bold family at 56px and -0.02em tracking.', () => {
            const cls = components['.display-1'];
            expect(cls.fontFamily).toBe('BricolageGrotesque_700Bold');
            expect(cls.fontSize).toBe('56px');
            expect(cls.lineHeight).toBe('0.96');
            expect(cls.letterSpacing).toBe('-0.02em');
        });

        it('emits eyebrow with the Geist Medium family + uppercase + 0.14em tracking + fg-muted color.', () => {
            const cls = components['.eyebrow'];
            expect(cls.fontFamily).toBe('Geist_500Medium');
            expect(cls.fontSize).toBe('11px');
            expect(cls.textTransform).toBe('uppercase');
            expect(cls.letterSpacing).toBe('0.14em');
            expect(cls.color).toBe('#8A9690');
        });

        it('emits num-hero with the Geist Mono Medium family + tnum + ss01 feature settings.', () => {
            const cls = components['.num-hero'];
            expect(cls.fontFamily).toBe('GeistMono_500Medium');
            expect(cls.fontSize).toBe('72px');
            expect(cls.fontFeatureSettings).toContain('tnum');
            expect(cls.fontFeatureSettings).toContain('ss01');
        });

        it('emits the rest of the body / heading / numeric classes by name.', () => {
            const expected = [
                '.display-2',
                '.display-3',
                '.h1',
                '.h2',
                '.h3',
                '.label',
                '.body-lg',
                '.body',
                '.body-sm',
                '.num-lg',
                '.num',
                '.num-sm',
            ];
            for (const name of expected) expect(components[name]).toBeDefined();
        });
    });

    describe('motion', () => {
        const durations = theme.transitionDuration as Record<string, string>;
        const easings = theme.transitionTimingFunction as Record<string, string>;

        it('exposes d-1 / d-2 / d-3 as 120ms / 220ms / 360ms.', () => {
            expect(durations[1]).toBe('120ms');
            expect(durations[2]).toBe('220ms');
            expect(durations[3]).toBe('360ms');
        });

        it('exposes ease-out (accelerate-out, settle-in) and ease-in-out curves.', () => {
            expect(easings['ease-out']).toBe('cubic-bezier(0.2, 0.7, 0.2, 1)');
            expect(easings['ease-in-out']).toBe('cubic-bezier(0.6, 0, 0.2, 1)');
        });
    });
});
