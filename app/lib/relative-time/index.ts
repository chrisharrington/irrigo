/**
 * Formats an ISO-8601 timestamp into a short relative-age label used by the
 * alert region and the activity feed. Buckets:
 *
 * | Age                  | Output |
 * |----------------------|--------|
 * | < 60 s (or future)   | `now`  |
 * | < 60 min             | `Nm`   |
 * | < 24 h               | `Nh`   |
 * | ≥ 24 h               | `Nd`   |
 *
 * `reference` is the "now" anchor — production callers omit it; tests inject
 * a fixed `Date` so assertions are deterministic.
 */
export function formatRelativeTime(iso: string, reference: Date = new Date()): string {
    const ageMs = reference.getTime() - new Date(iso).getTime();
    if (ageMs < 60_000) return 'now';

    const ageMinutes = Math.floor(ageMs / 60_000);
    if (ageMinutes < 60) return `${ageMinutes}m`;

    const ageHours = Math.floor(ageMinutes / 60);
    if (ageHours < 24) return `${ageHours}h`;

    const ageDays = Math.floor(ageHours / 24);
    return `${ageDays}d`;
}
