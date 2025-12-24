import type { Config } from 'tailwindcss';
import colours from './constants/colours';

const config: Config = {
    content: [
        './app/**/*.{js,jsx,ts,tsx}',
        './components/**/*.{js,jsx,ts,tsx}',
        './screens/**/*.{js,jsx,ts,tsx}',
    ],
    presets: [require('nativewind/preset')],
    theme: {
        extend: {
            colors: colours,
        },
    },
    plugins: [],
};

export default config;
