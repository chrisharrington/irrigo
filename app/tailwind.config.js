const plugin = require('tailwindcss/plugin');

/** @type {import('tailwindcss').Config} */
module.exports = {
    content: [
        './app/**/*.{js,jsx,ts,tsx}',
        './components/**/*.{js,jsx,ts,tsx}',
    ],
    presets: [require('nativewind/preset')],
    theme: {
        extend: {
            colors: {
                // Ink ramp (raw).
                'ink-0': '#04060500',
                'ink-50': '#06090A',
                'ink-100': '#0B1110',
                'ink-200': '#0E1412',
                'ink-300': '#141B18',
                'ink-400': '#1B231F',
                'ink-500': '#232E29',
                'ink-600': '#344239',
                'ink-700': '#495A50',

                // Chalk ramp (raw).
                'chalk-50': '#ECF1ED',
                'chalk-200': '#C7CFC9',
                'chalk-400': '#8A9690',
                'chalk-600': '#5A6862',
                'chalk-800': '#3A4641',

                // Grass ramp (raw) + glow.
                'grass-300': '#B7F0CB',
                'grass-400': '#8FEAB1',
                'grass-500': '#6FE39B',
                'grass-600': '#4FCB7E',
                'grass-700': '#2C8F5A',
                'grass-900': '#0F2A1C',
                'grass-glow': 'rgba(111, 227, 155, 0.18)',
                'grass-glow-2': 'rgba(111, 227, 155, 0.06)',
                'grass-glow-3': 'rgba(111, 227, 155, 0.07)',

                // Accent supplemental.
                'water-500': '#7CD4FB',
                'water-700': '#2E7FA8',
                'water-glow': 'rgba(124, 212, 251, 0.04)',
                'amber-500': '#FFBE6B',
                'amber-700': '#B07B2A',
                'rose-500': '#FF6B7B',
                'rose-700': '#A23744',
                'moon-500': '#D8C690',

                // Semantic.
                bg: '#06090A',
                'bg-alt': '#0B1110',
                surface: '#0E1412',
                'surface-2': '#141B18',
                elevated: '#1B231F',
                hairline: '#232E29',
                border: '#232E29',
                'border-strong': '#344239',
                fg: '#ECF1ED',
                'fg-soft': '#C7CFC9',
                'fg-muted': '#8A9690',
                'fg-dim': '#5A6862',
                'fg-faint': '#3A4641',
                accent: '#6FE39B',
                'accent-press': '#4FCB7E',
                'accent-deep': '#2C8F5A',
                'accent-glow': 'rgba(111, 227, 155, 0.18)',
                'accent-border': 'rgba(111, 227, 155, 0.4)',
                'accent-tint': 'rgba(111, 227, 155, 0.06)',
                info: '#7CD4FB',
                'info-border': 'rgba(124, 212, 251, 0.4)',
                'info-tint': 'rgba(124, 212, 251, 0.06)',
                warn: '#FFBE6B',
                'warn-border': 'rgba(255, 190, 107, 0.4)',
                'warn-tint': 'rgba(255, 190, 107, 0.06)',
                danger: '#FF6B7B',
                'danger-border': 'rgba(255, 107, 123, 0.4)',
                'danger-tint': 'rgba(255, 107, 123, 0.06)',
                'on-accent': '#052013',
                scrim: 'rgba(2, 4, 3, 0.66)',

                // Depletion ramp (saturated → past RAW).
                'depletion-0': '#6FE39B',
                'depletion-1': '#9CE093',
                'depletion-2': '#C8DD7B',
                'depletion-3': '#E9C96D',
                'depletion-4': '#FFBE6B',
                'depletion-5': '#FF9B6F',
                'depletion-6': '#FF6B7B',
            },
            spacing: {
                's-1': '4px',
                's-2': '8px',
                's-3': '12px',
                's-4': '16px',
                's-5': '20px',
                's-6': '24px',
                's-7': '32px',
                's-8': '40px',
                's-9': '48px',
                's-10': '64px',
                's-11': '80px',
                's-12': '96px',
            },
            borderRadius: {
                'r-1': '4px',
                'r-2': '4px',
                'r-3': '4px',
                'r-4': '4px',
                'r-5': '4px',
                'r-pill': '4px',
            },
            boxShadow: {
                1: '0 1px 0 0 rgba(255, 255, 255, 0.03) inset, 0 1px 2px rgba(0, 0, 0, 0.4)',
                2: '0 1px 0 0 rgba(255, 255, 255, 0.04) inset, 0 4px 14px rgba(0, 0, 0, 0.45), 0 1px 2px rgba(0, 0, 0, 0.3)',
                3: '0 1px 0 0 rgba(255, 255, 255, 0.05) inset, 0 20px 48px rgba(0, 0, 0, 0.6), 0 4px 10px rgba(0, 0, 0, 0.4)',
                'glow-accent': '0 0 0 1px rgba(111, 227, 155, 0.28) inset, 0 0 24px -4px rgba(111, 227, 155, 0.18)',
            },
            fontFamily: {
                // Bricolage Grotesque — display weights, loaded by FontLoader.
                display: ['BricolageGrotesque_400Regular'],
                'display-medium': ['BricolageGrotesque_500Medium'],
                'display-semibold': ['BricolageGrotesque_600SemiBold'],
                'display-bold': ['BricolageGrotesque_700Bold'],
                // Geist — body / UI weights.
                'sans-light': ['Geist_300Light'],
                sans: ['Geist_400Regular'],
                'sans-medium': ['Geist_500Medium'],
                'sans-semibold': ['Geist_600SemiBold'],
                'sans-bold': ['Geist_700Bold'],
                // Geist Mono — numeric weights for values that must align in columns.
                mono: ['GeistMono_400Regular'],
                'mono-medium': ['GeistMono_500Medium'],
                'mono-semibold': ['GeistMono_600SemiBold'],
            },
            fontSize: {
                'display-1': ['56px', { lineHeight: '0.96', letterSpacing: '-0.02em' }],
                'display-2': ['40px', { lineHeight: '1.02', letterSpacing: '-0.018em' }],
                'display-3': ['28px', { lineHeight: '1.08', letterSpacing: '-0.015em' }],
                'h-1': ['22px', { lineHeight: '1.2', letterSpacing: '-0.01em' }],
                'h-2': ['18px', { lineHeight: '1.25', letterSpacing: '-0.005em' }],
                'h-3': ['15px', { lineHeight: '1.3' }],
                eyebrow: ['11px', { lineHeight: '1.2', letterSpacing: '0.14em' }],
                label: ['12px', { lineHeight: '1.3' }],
                'body-lg': ['16px', { lineHeight: '1.5' }],
                body: ['14px', { lineHeight: '1.5' }],
                'body-sm': ['12px', { lineHeight: '1.45' }],
                'num-hero': ['72px', { lineHeight: '0.95', letterSpacing: '-0.04em' }],
                'num-lg': ['28px', { lineHeight: '1', letterSpacing: '-0.02em' }],
                num: ['14px', { lineHeight: '1.2' }],
                'num-sm': ['11px', { lineHeight: '1.2' }],
            },
            transitionDuration: {
                1: '120ms',
                2: '220ms',
                3: '360ms',
            },
            transitionTimingFunction: {
                'ease-out': 'cubic-bezier(0.2, 0.7, 0.2, 1)',
                'ease-in-out': 'cubic-bezier(0.6, 0, 0.2, 1)',
            },
        },
    },
    plugins: [
        plugin(function ({ addComponents }) {
            // Plugin component classes use the exact font family names registered
            // by FontLoader's useFonts call (weight baked into the family name).
            // fontWeight is intentionally omitted — React Native resolves custom
            // fonts by family name, not by family-name + weight.
            addComponents({
                '.display-1': {
                    fontFamily: 'BricolageGrotesque_700Bold',
                    fontSize: '56px',
                    lineHeight: '0.96',
                    letterSpacing: '-0.02em',
                },
                '.display-2': {
                    fontFamily: 'BricolageGrotesque_600SemiBold',
                    fontSize: '40px',
                    lineHeight: '1.02',
                    letterSpacing: '-0.018em',
                },
                '.display-3': {
                    fontFamily: 'BricolageGrotesque_600SemiBold',
                    fontSize: '28px',
                    lineHeight: '1.08',
                    letterSpacing: '-0.015em',
                },
                '.h1': {
                    fontFamily: 'BricolageGrotesque_600SemiBold',
                    fontSize: '22px',
                    lineHeight: '1.2',
                    letterSpacing: '-0.01em',
                },
                '.h2': {
                    fontFamily: 'BricolageGrotesque_600SemiBold',
                    fontSize: '18px',
                    lineHeight: '1.25',
                    letterSpacing: '-0.005em',
                },
                '.h3': {
                    fontFamily: 'Geist_600SemiBold',
                    fontSize: '15px',
                    lineHeight: '1.3',
                },
                '.eyebrow': {
                    fontFamily: 'Geist_500Medium',
                    fontSize: '11px',
                    lineHeight: '1.2',
                    textTransform: 'uppercase',
                    letterSpacing: '0.14em',
                    color: '#8A9690',
                },
                '.label': {
                    fontFamily: 'Geist_500Medium',
                    fontSize: '12px',
                    lineHeight: '1.3',
                    color: '#8A9690',
                },
                '.body-lg': {
                    fontFamily: 'Geist_400Regular',
                    fontSize: '16px',
                    lineHeight: '1.5',
                },
                '.body': {
                    fontFamily: 'Geist_400Regular',
                    fontSize: '14px',
                    lineHeight: '1.5',
                },
                '.body-sm': {
                    fontFamily: 'Geist_400Regular',
                    fontSize: '12px',
                    lineHeight: '1.45',
                    color: '#C7CFC9',
                },
                '.num-hero': {
                    fontFamily: 'GeistMono_500Medium',
                    fontSize: '72px',
                    lineHeight: '0.95',
                    letterSpacing: '-0.04em',
                    fontFeatureSettings: '"ss01", "tnum"',
                },
                '.num-lg': {
                    fontFamily: 'GeistMono_500Medium',
                    fontSize: '28px',
                    lineHeight: '1',
                    letterSpacing: '-0.02em',
                    fontFeatureSettings: '"tnum"',
                },
                '.num': {
                    fontFamily: 'GeistMono_500Medium',
                    fontSize: '14px',
                    lineHeight: '1.2',
                    fontFeatureSettings: '"tnum"',
                },
                '.num-sm': {
                    fontFamily: 'GeistMono_500Medium',
                    fontSize: '11px',
                    lineHeight: '1.2',
                    fontFeatureSettings: '"tnum"',
                },
            });
        }),
    ],
};
