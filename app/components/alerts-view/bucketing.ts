import dayjs from 'dayjs';

import type { AlertClass } from '@/api/types/alerts';
import { MS_PER_HOUR } from '@/constants/duration';

/**
 * Recency group an alert falls into on the Alerts screen. Drives the
 * grouped-list headers (New / Earlier today / This week / Older).
 */
export type AlertBucket = 'new' | 'today' | 'week' | 'older';

// Calendar-day span (exclusive) that still counts as "this week".
const WEEK_DAYS = 7;

/**
 * Buckets an alert by the age of its `when` instant against the device clock.
 *
 * Rules, in order:
 *   - under an hour old (or future-dated)   → `'new'`
 *   - same device-local calendar day         → `'today'`
 *   - within the last 7 calendar days        → `'week'`
 *   - older                                  → `'older'`
 *
 * Calendar-day comparisons run in the device-local timezone (APP-88) so a
 * UTC-late instant that still reads as "today" locally doesn't slip a bucket.
 *
 * @param when - The alert's ISO-8601 UTC instant.
 * @param now - The "now" anchor; tests inject a fixed value.
 * @returns The recency bucket.
 */
export function bucketFor(when: string, now: Date): AlertBucket {
    const target = dayjs(when),
        present = dayjs(now);

    // Under an hour (or clock skew / future-dated data) lands in `new`.
    const ageMs = present.valueOf() - target.valueOf();
    if (ageMs < MS_PER_HOUR) return 'new';

    // Calendar-day offset, anchored in the site timezone.
    const dayDiff = present.startOf('day').diff(target.startOf('day'), 'day');
    if (dayDiff <= 0) return 'today';
    if (dayDiff < WEEK_DAYS) return 'week';
    return 'older';
}

/**
 * Formats an alert's `when` for the card's monospace timestamp slot, in
 * 12-hour device-local time. Resolution widens with age so older rows stay
 * legible:
 *
 *   - `new` / `today` → `'2:02 pm'`
 *   - `week`          → `'Mon 11:47 pm'`
 *   - `older`         → `'May 12'`
 *
 * @param when - The alert's ISO-8601 UTC instant.
 * @param now - The "now" anchor used to pick the bucket.
 * @returns The formatted timestamp.
 */
export function formatAlertTimestamp(when: string, now: Date): string {
    const target = dayjs(when),
        bucket = bucketFor(when, now);

    if (bucket === 'week') return target.format('ddd h:mm a');
    if (bucket === 'older') return target.format('MMM D');
    return target.format('h:mm a');
}

/**
 * Maps the wire's `class` onto the kind tag shown on each card. The wire
 * owns the class taxonomy; this is purely a display string. The mock's
 * richer kind set (PLAN / DEPLETION / AUTH / PROFILE) has no wire class
 * today, so only the three live classes are mapped.
 */
export const KIND_LABEL: Readonly<Record<AlertClass, string>> = {
    'ha-call-failed': 'CONNECTION',
    'weather-stale': 'FORECAST',
    'missed-close': 'RUN',
};
