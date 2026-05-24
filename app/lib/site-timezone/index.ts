/**
 * Default IANA timezone used when `EXPO_PUBLIC_SITE_TIMEZONE` is unset.
 * Matches the design source's eyebrow text.
 */
const DEFAULT_SITE_TIMEZONE = 'America/Edmonton';

/**
 * Returns the IANA timezone string for site-local time formatting. Reads
 * `EXPO_PUBLIC_SITE_TIMEZONE` at call time (not at module load) so tests
 * can override it via `process.env` per case. Falls back to
 * `'America/Edmonton'` when the env var is missing or blank.
 */
export function getSiteTimezone(): string {
    const fromEnv = process.env.EXPO_PUBLIC_SITE_TIMEZONE;
    if (typeof fromEnv === 'string' && fromEnv.trim().length > 0) {
        return fromEnv;
    }
    return DEFAULT_SITE_TIMEZONE;
}
