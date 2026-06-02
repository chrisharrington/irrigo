import { formatActivityRowDate, formatCountdown, formatEndsAt, formatLastRan, formatNextRunDate, formatRelativeTime, formatTimeOfDay } from '.';

// The test env is pinned to America/Edmonton (TZ in package.json), so
// device-local formatting reads as MDT (UTC-6) for the warm-month fixtures.
// 2026-05-23T15:00:00Z = 09:00 MDT on 2026-05-23 (Saturday).
const NOW = new Date('2026-05-23T15:00:00.000Z');

describe('formatLastRan', () => {
    it('returns the empty string when iso is null.', () => {
        expect(formatLastRan(null, NOW)).toBe('');
    });

    it('returns "just now" within the same hour.', () => {
        const isoMinutesAgo = new Date(NOW.getTime() - 15 * 60_000).toISOString();
        expect(formatLastRan(isoMinutesAgo, NOW)).toBe('just now');
    });

    it('returns "<n>h ago" within the same calendar day window.', () => {
        const isoHoursAgo = new Date(NOW.getTime() - 5 * 60 * 60_000).toISOString();
        expect(formatLastRan(isoHoursAgo, NOW)).toBe('5h ago');
    });

    it('returns "last night" for exactly one day prior.', () => {
        const isoOneDayAgo = new Date(NOW.getTime() - 24 * 60 * 60_000 - 60_000).toISOString();
        expect(formatLastRan(isoOneDayAgo, NOW)).toBe('last night');
    });

    it('returns "<n> nights ago" for older runs.', () => {
        const isoThreeDaysAgo = new Date(NOW.getTime() - 3 * 24 * 60 * 60_000).toISOString();
        expect(formatLastRan(isoThreeDaysAgo, NOW)).toBe('3 nights ago');
    });

    it('counts calendar nights, not 24h spans — a run 24-48h back across two midnights reads "2 nights ago". APP-87.', () => {
        // 2026-05-22T05:00:00Z = 23:00 MDT on 2026-05-21, ~34h before NOW
        // (09:00 MDT May 23). Two midnights have passed, so it is two nights
        // ago — the raw-ms bucketing bug rendered this as "last night".
        expect(formatLastRan('2026-05-22T05:00:00.000Z', NOW)).toBe('2 nights ago');
    });

    it('treats a run on the previous calendar day as "last night" even when read in the evening. APP-87.', () => {
        // 2026-05-22T05:30:00Z = 23:30 MDT on 2026-05-21 (one calendar day
        // before), read at 21:00 MDT on 2026-05-22 — ~21.5h, one midnight.
        const eveningOfMay22 = new Date('2026-05-23T03:00:00.000Z'); // 21:00 MDT May 22
        expect(formatLastRan('2026-05-22T05:30:00.000Z', eveningOfMay22)).toBe('last night');
    });

    it('clamps future-dated input to "just now" (defensive: clock skew, upstream bugs). APP-55.', () => {
        const isoOneHourAhead = new Date(NOW.getTime() + 60 * 60_000).toISOString();
        expect(formatLastRan(isoOneHourAhead, NOW)).toBe('just now');
    });

    it('clamps far-future input to "just now" rather than rendering negative day buckets. APP-55.', () => {
        const isoTwoDaysAhead = new Date(NOW.getTime() + 2 * 24 * 60 * 60_000).toISOString();
        expect(formatLastRan(isoTwoDaysAhead, NOW)).toBe('just now');
    });
});

describe('formatCountdown', () => {
    it('returns "—" for null.', () => {
        expect(formatCountdown(null, NOW)).toBe('—');
    });

    it('returns "now" within a minute of the target.', () => {
        const isoAlmostNow = new Date(NOW.getTime() + 30_000).toISOString();
        expect(formatCountdown(isoAlmostNow, NOW)).toBe('now');
    });

    it('returns sub-hour minutes as "<n>m".', () => {
        const iso42mAhead = new Date(NOW.getTime() + 42 * 60_000).toISOString();
        expect(formatCountdown(iso42mAhead, NOW)).toBe('42m');
    });

    it('returns multi-hour deltas as "<h>h <m>m".', () => {
        const iso8h14mAhead = new Date(NOW.getTime() + (8 * 60 + 14) * 60_000).toISOString();
        expect(formatCountdown(iso8h14mAhead, NOW)).toBe('8h 14m');
    });

    it('elides minutes when the delta is on the hour.', () => {
        const iso3hSharpAhead = new Date(NOW.getTime() + 3 * 60 * 60_000).toISOString();
        expect(formatCountdown(iso3hSharpAhead, NOW)).toBe('3h 0m');
    });
});

describe('formatTimeOfDay', () => {
    it('formats a UTC instant as a 24-hour clock in the device timezone.', () => {
        // 2026-05-23T04:23Z = 22:23 MDT on 2026-05-22 (Friday night).
        expect(formatTimeOfDay('2026-05-23T04:23:00.000Z')).toBe('22:23');
    });

    it('zero-pads the morning side of the boundary.', () => {
        // 2026-05-23T11:48Z = 05:48 MDT on 2026-05-23 (Saturday morning).
        expect(formatTimeOfDay('2026-05-23T11:48:00.000Z')).toBe('05:48');
    });
});

describe('formatActivityRowDate', () => {
    it(`formats both the day and the time-of-day from startedAt in the device timezone.`, () => {
        // 2026-05-13T15:00:00Z = 09:00 MDT on 2026-05-13.
        expect(formatActivityRowDate('2026-05-13', '2026-05-13T15:00:00.000Z')).toBe('May 13 · 09:00');
    });

    it(`keys both the day and the time off startedAt — so a UTC instant that rolls back to the previous local day renders on that local day.`, () => {
        // 2026-05-14T05:30:00Z = 23:30 MDT on 2026-05-13. The bare 'date'
        // field says May 14 (the planner's scheduled-night bucket); the
        // formatter prefers startedAt and shows the actual local day.
        expect(formatActivityRowDate('2026-05-14', '2026-05-14T05:30:00.000Z')).toBe('May 13 · 23:30');
    });

    it(`falls back to date-only 'MMM D' when startedAt is null.`, () => {
        expect(formatActivityRowDate('2026-05-13', null)).toBe('May 13');
    });

    it(`formats the date-only fallback verbatim from the day-only string.`, () => {
        // A null startedAt returns the calendar-day label straight from the
        // bare YYYY-MM-DD string — no instant, no timezone math.
        expect(formatActivityRowDate('2026-05-13', null)).toBe('May 13');
    });
});

describe('formatEndsAt', () => {
    it('formats the ends-at like formatTimeOfDay.', () => {
        expect(formatEndsAt('2026-05-23T11:48:00.000Z')).toBe('05:48');
    });
});

describe('formatNextRunDate', () => {
    // 2026-05-23T15:00:00Z = 09:00 MDT on 2026-05-23 (Saturday).
    const NOW_LOCAL_SATURDAY = new Date('2026-05-23T15:00:00.000Z');

    it(`returns 'Today, D MMM' when the run lands on the same local calendar day.`, () => {
        // 2026-05-24T04:23Z = 22:23 MDT on 2026-05-23 — still Saturday local.
        expect(formatNextRunDate('2026-05-24T04:23:00.000Z', NOW_LOCAL_SATURDAY)).toBe('Today, 23 May');
    });

    it(`returns 'Today, D MMM' when the run is already in the past.`, () => {
        // 2026-05-22T12:00Z = 06:00 MDT on 2026-05-22 (Friday) — one day before NOW.
        expect(formatNextRunDate('2026-05-22T12:00:00.000Z', NOW_LOCAL_SATURDAY)).toBe('Today, 22 May');
    });

    it(`returns 'Tomorrow, D MMM' for the next local calendar day.`, () => {
        // 2026-05-25T04:23Z = 22:23 MDT on 2026-05-24 (Sunday) — one day on from Saturday.
        expect(formatNextRunDate('2026-05-25T04:23:00.000Z', NOW_LOCAL_SATURDAY)).toBe('Tomorrow, 24 May');
    });

    it(`returns 'Ddd, D MMM' for runs 2+ days out.`, () => {
        // 2026-05-27T04:23Z = 22:23 MDT on 2026-05-26 (Tuesday) — three days on.
        expect(formatNextRunDate('2026-05-27T04:23:00.000Z', NOW_LOCAL_SATURDAY)).toBe('Tue, 26 May');
    });

    it(`returns the same 'Ddd, D MMM' format for runs 7+ days out (no separate far-future bucket).`, () => {
        // 2026-06-03T04:23Z = 22:23 MDT on 2026-06-02 (Tuesday) — ten days on.
        expect(formatNextRunDate('2026-06-03T04:23:00.000Z', NOW_LOCAL_SATURDAY)).toBe('Tue, 2 Jun');
    });

    it('uses the device timezone for the calendar-day comparison, not UTC.', () => {
        // 2026-05-24T05:30Z is "Sunday" in UTC but 23:30 MDT on Saturday locally —
        // still the same calendar day as NOW_LOCAL_SATURDAY (09:00 MDT Sat).
        expect(formatNextRunDate('2026-05-24T05:30:00.000Z', NOW_LOCAL_SATURDAY)).toBe('Today, 23 May');
    });
});

describe('formatRelativeTime', () => {
    const ref = new Date('2026-05-24T12:00:00.000Z');

    it(`returns 'now' for ages under 60 seconds.`, () => {
        expect(formatRelativeTime('2026-05-24T11:59:30.000Z', ref)).toBe('now');
    });

    it(`returns 'now' for future timestamps (clock skew).`, () => {
        expect(formatRelativeTime('2026-05-24T13:00:00.000Z', ref)).toBe('now');
    });

    it(`returns 'Nm' between 60 seconds and 60 minutes.`, () => {
        expect(formatRelativeTime('2026-05-24T11:58:00.000Z', ref)).toBe('2m');
        expect(formatRelativeTime('2026-05-24T11:48:00.000Z', ref)).toBe('12m');
        expect(formatRelativeTime('2026-05-24T11:01:00.000Z', ref)).toBe('59m');
    });

    it(`flips from 'Nm' to 'Nh' at the 60-minute boundary.`, () => {
        expect(formatRelativeTime('2026-05-24T11:00:00.000Z', ref)).toBe('1h');
    });

    it(`returns 'Nh' between 60 minutes and 24 hours.`, () => {
        expect(formatRelativeTime('2026-05-24T10:00:00.000Z', ref)).toBe('2h');
        expect(formatRelativeTime('2026-05-23T13:00:00.000Z', ref)).toBe('23h');
    });

    it(`returns 'Nd' at or beyond 24 hours.`, () => {
        expect(formatRelativeTime('2026-05-23T12:00:00.000Z', ref)).toBe('1d');
        expect(formatRelativeTime('2026-05-21T12:00:00.000Z', ref)).toBe('3d');
    });
});
