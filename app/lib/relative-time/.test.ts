import { formatCountdown, formatEndsAt, formatLastRan, formatTimeOfDay } from '.';

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
