/** @type {import('tailwindcss').Config} */
module.exports = {
    content: [
        './app/**/*.{js,jsx,ts,tsx}',
        './components/**/*.{js,jsx,ts,tsx}',
    ],
    presets: [require('nativewind/preset')],
    theme: {
        extend: {
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
        },
    },
    plugins: [],
};
