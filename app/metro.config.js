const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);

// Keep test files out of the app bundle. Expo Router enumerates every
// `.tsx` under `app/app/` via `require.context`, which would otherwise drag
// `_layout.test.tsx` (and any future co-located route tests) into the
// runtime bundle and fail on Node-only imports like `console`.
config.resolver.blockList = [
    ...config.resolver.blockList,
    /\.test\.[jt]sx?$/,
];

module.exports = withNativeWind(config, { input: './global.css' });
