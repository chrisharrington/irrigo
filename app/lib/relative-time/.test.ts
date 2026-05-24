import { formatCountdown, formatCycleWindow, formatEndsAt, formatLastRan, formatNextRunDate, formatRelativeTime, formatTimeOfDay } from '.';

const TZ = 'America/Edmonton';
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
    it('formats a UTC instant as a 12-hour clock with am/pm in the site timezone.', () => {
        // 2026-05-23T04:23Z = 22:23 MDT on 2026-05-22 (Friday night).
        expect(formatTimeOfDay('2026-05-23T04:23:00.000Z', TZ)).toBe('10:23 pm');
    });

    it('renders the am side of the boundary.', () => {
        // 2026-05-23T11:48Z = 05:48 MDT on 2026-05-23 (Saturday morning).
        expect(formatTimeOfDay('2026-05-23T11:48:00.000Z', TZ)).toBe('5:48 am');
    });
});

describe('formatEndsAt', () => {
    it('formats the ends-at like formatTimeOfDay.', () => {
        expect(formatEndsAt('2026-05-23T11:48:00.000Z', TZ)).toBe('5:48 am');
    });
});

describe('formatCycleWindow', () => {
    it('renders a basic am window with the midnight hour as 12.', () => {
        expect(formatCycleWindow('00:13', 34)).toBe('12:13 am to 12:47 am');
    });

    it('renders a basic pm window with 24h → 12h conversion.', () => {
        expect(formatCycleWindow('14:30', 25)).toBe('2:30 pm to 2:55 pm');
    });

    it('flips am → pm across the noon boundary.', () => {
        expect(formatCycleWindow('11:50', 20)).toBe('11:50 am to 12:10 pm');
    });

    it('wraps pm → am past midnight via modular minute arithmetic.', () => {
        expect(formatCycleWindow('23:50', 30)).toBe('11:50 pm to 12:20 am');
    });

    it('drops the leading zero on single-digit hours.', () => {
        expect(formatCycleWindow('06:05', 9)).toBe('6:05 am to 6:14 am');
    });
});

describe('formatNextRunDate', () => {
    // 2026-05-23T15:00:00Z = 09:00 MDT on 2026-05-23 (Saturday).
    const NOW_LOCAL_SATURDAY = new Date('2026-05-23T15:00:00.000Z');

    it(`returns '' when the run lands on the same local calendar day.`, () => {
        // 2026-05-24T04:23Z = 22:23 MDT on 2026-05-23 — still Saturday local.
        expect(formatNextRunDate('2026-05-24T04:23:00.000Z', TZ, NOW_LOCAL_SATURDAY)).toBe('');
    });

    it(`returns '' when the run is already in the past.`, () => {
        expect(formatNextRunDate('2026-05-22T12:00:00.000Z', TZ, NOW_LOCAL_SATURDAY)).toBe('');
    });

    it(`returns 'Tomorrow' for the next local calendar day.`, () => {
        // 2026-05-25T04:23Z = 22:23 MDT on 2026-05-24 (Sunday) — one day on from Saturday.
        expect(formatNextRunDate('2026-05-25T04:23:00.000Z', TZ, NOW_LOCAL_SATURDAY)).toBe('Tomorrow');
    });

    it('returns the short weekday for runs 2–6 days out.', () => {
        // 2026-05-27T04:23Z = 22:23 MDT on 2026-05-26 (Tuesday) — three days on.
        expect(formatNextRunDate('2026-05-27T04:23:00.000Z', TZ, NOW_LOCAL_SATURDAY)).toBe('Tue');
    });

    it(`returns the long form 'Ddd D MMM' for runs 7+ days out.`, () => {
        // 2026-06-03T04:23Z = 22:23 MDT on 2026-06-02 (Tuesday) — ten days on.
        expect(formatNextRunDate('2026-06-03T04:23:00.000Z', TZ, NOW_LOCAL_SATURDAY)).toBe('Tue 2 Jun');
    });

    it('uses the site timezone for the calendar-day comparison, not UTC.', () => {
        // 2026-05-24T05:30Z is "Sunday" in UTC but 23:30 MDT on Saturday locally —
        // still the same calendar day as NOW_LOCAL_SATURDAY (09:00 MDT Sat).
        expect(formatNextRunDate('2026-05-24T05:30:00.000Z', TZ, NOW_LOCAL_SATURDAY)).toBe('');
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
