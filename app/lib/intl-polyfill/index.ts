// Polyfills `Intl.getCanonicalLocales`, `Intl.Locale`, and
// `Intl.DateTimeFormat` (with the full IANA timezone database) on Hermes.
//
// Why: Hermes — the JS engine in Expo SDK 56 / RN 0.85 — ships without
// complete ICU timezone-database data on Android. When dayjs's `timezone`
// plugin calls `Date.prototype.toLocaleString('en-US', { timeZone: 'America/Edmonton' })`,
// Hermes silently ignores the `timeZone` option and returns the device-local
// rendering. The plugin then computes a zero net offset and falls back to
// UTC, so every site-local time renders in UTC on-device. The polyfills
// here replace `Intl` with a JS implementation that honours `timeZone`, and
// `add-all-tz` ships the full tz database so any named zone resolves. APP-77.
//
// Safe to import unconditionally — each formatjs polyfill checks the host's
// native implementation and no-ops when it's already complete (which it is
// in Node, so jest is unaffected; it's the Hermes path the polyfills fix).

import '@formatjs/intl-getcanonicallocales/polyfill-force.js';
import '@formatjs/intl-locale/polyfill-force.js';
import '@formatjs/intl-datetimeformat/polyfill-force.js';
import '@formatjs/intl-datetimeformat/add-all-tz.js';
import '@formatjs/intl-datetimeformat/locale-data/en.js';
