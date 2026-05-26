import type { AlertTone } from '@/api/types/alerts';
import config from '@/tailwind.config';

const colors = config.theme.extend.colors;

/**
 * Severity tones surfaced by aggregate alert UI (currently the header
 * bell badge — APP-62). `'info'` covers the "alerts present but none
 * warn / danger" case; unreachable on the wire today (the API only emits
 * warn / danger) but the value keeps the type honest if the contract
 * grows to include info-level alerts in the future.
 */
export type AlertSeverity = AlertTone | 'info';

/**
 * Per-severity hex used to tint aggregate alert UI. Source: the
 * AlertBell mock in `app/design/ui_kit/Alerts.jsx`. Distinct from
 * `AlertRow`'s per-tone palette, which uses richer `tint + border +
 * accent + icon` quadruples — aggregate badges only need the dominant
 * accent colour.
 */
export const SEVERITY_COLOR: Readonly<Record<AlertSeverity, string>> = {
    danger: colors.danger,
    warn: colors.warn,
    info: colors.accent,
};

/**
 * Returns the highest-priority tone among the supplied alerts:
 * `danger` > `warn` > `info`. Drives the colour of aggregate alert UI so
 * the worst unacked condition wins the visual urgency.
 */
export function highestSeverity(alerts: ReadonlyArray<{ tone: AlertTone }>): AlertSeverity {
    if (alerts.some(a => a.tone === 'danger')) return 'danger';
    if (alerts.some(a => a.tone === 'warn')) return 'warn';
    return 'info';
}
