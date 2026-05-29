// Side-effect-only polyfill subpaths from `@formatjs` that don't ship their
// own `.d.ts` declarations. Tells TypeScript 6+ (strict module resolution)
// that these imports are valid side-effect imports without needing types
// for the modules themselves. APP-77.

declare module '@formatjs/intl-getcanonicallocales/polyfill-force.js';
declare module '@formatjs/intl-locale/polyfill-force.js';
declare module '@formatjs/intl-datetimeformat/polyfill-force.js';
declare module '@formatjs/intl-datetimeformat/add-all-tz.js';
declare module '@formatjs/intl-datetimeformat/locale-data/en.js';
