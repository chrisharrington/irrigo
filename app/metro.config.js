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

// Force Metro onto Watchman instead of its `fs.watch`-based fallback. Without
// this, edits made from inside the dev container (different mount namespace
// than the metro container) are unreliably reported to Metro's recursive
// `fs.watch` watchers — manual saves usually land, but Claude's atomic
// write-then-rename pattern gets dropped, leaving the bundler serving stale
// transforms until the container is restarted.
//
// Why the `1` instead of `true`: `@expo/metro-config`'s `loadUserConfig`
// rewrites `resolver.useWatchman === true` to `null` as a legacy perf
// workaround, and `@expo/cli`'s `createFileMap-fork.js` then collapses that
// `null` back to `false` via `?? false`. Any truthy value that isn't
// strictly `true` (here: `1`) bypasses the rewrite and survives the
// nullish-coalesce, leaving the file map with a truthy `useWatchman` so it
// picks the `WatchmanWatcher` instead of the `FallbackWatcher`. Verify with
// `docker exec irrigo-metro watchman debug-get-subscriptions /app` — a Metro
// subscriber should appear there when this is working.
config.resolver.useWatchman = 1;

module.exports = withNativeWind(config, { input: './global.css' });
