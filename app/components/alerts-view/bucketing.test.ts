import { bucketFor, formatAlertTimestamp, KIND_LABEL } from './bucketing';

// Fixed device clock: 2026-05-29 14:30 local in America/Edmonton (UTC-06 in
// May; pinned via TZ in package.json). All `when` instants below are expressed
// in UTC and chosen so their device-local reading lands deterministically in
// the bucket under test.
const NOW = new Date('2026-05-29T20:30:00.000Z'); // 14:30 device-local

describe('bucketFor', () => {
    it('buckets an instant under an hour old as `new`.', () => {
        // 14:00 site-local — 30 min before NOW.
        expect(bucketFor('2026-05-29T20:00:00.000Z', NOW)).toBe('new');
    });

    it('buckets a future-dated instant as `new` (clock-skew clamp).', () => {
        // 15:00 site-local — 30 min after NOW.
        expect(bucketFor('2026-05-29T21:00:00.000Z', NOW)).toBe('new');
    });

    it('buckets an earlier-same-day instant (>1h old) as `today`.', () => {
        // 02:41 site-local — same calendar day, ~12h old.
        expect(bucketFor('2026-05-29T08:41:00.000Z', NOW)).toBe('today');
    });

    it('buckets an instant just over an hour old (same day) as `today`.', () => {
        // 13:00 site-local — 90 min before NOW.
        expect(bucketFor('2026-05-29T19:00:00.000Z', NOW)).toBe('today');
    });

    it('buckets an instant one calendar day ago as `week`.', () => {
        // 23:21 site-local on May 28 — previous calendar day.
        expect(bucketFor('2026-05-29T05:21:00.000Z', NOW)).toBe('week');
    });

    it('buckets an instant six calendar days ago as `week`.', () => {
        // 10:00 site-local on May 23.
        expect(bucketFor('2026-05-23T16:00:00.000Z', NOW)).toBe('week');
    });

    it('buckets an instant seven calendar days ago as `older`.', () => {
        // 10:00 site-local on May 22.
        expect(bucketFor('2026-05-22T16:00:00.000Z', NOW)).toBe('older');
    });

    it('anchors the calendar-day boundary in the site timezone.', () => {
        // 23:30 site-local on May 28 is 05:30 UTC May 29 — a naive UTC-day
        // comparison would call this "today", but locally it's the prior day.
        expect(bucketFor('2026-05-29T05:30:00.000Z', NOW)).toBe('week');
    });
});

describe('formatAlertTimestamp', () => {
    it('formats new/today instants as 24-hour time of day.', () => {
        expect(formatAlertTimestamp('2026-05-29T20:02:00.000Z', NOW)).toBe('14:02');
    });

    it('formats this-week instants with a weekday prefix.', () => {
        // 23:21 site-local on May 28 (a Thursday).
        expect(formatAlertTimestamp('2026-05-29T05:21:00.000Z', NOW)).toBe('Thu 23:21');
    });

    it('formats older instants as a calendar date.', () => {
        expect(formatAlertTimestamp('2026-05-22T16:00:00.000Z', NOW)).toBe('May 22');
    });
});

describe('KIND_LABEL', () => {
    it('maps each wire class onto its display tag.', () => {
        expect(KIND_LABEL['ha-call-failed']).toBe('CONNECTION');
        expect(KIND_LABEL['weather-stale']).toBe('FORECAST');
        expect(KIND_LABEL['missed-close']).toBe('RUN');
    });
});
