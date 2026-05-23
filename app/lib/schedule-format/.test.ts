import {
    daysArrayFromAllowed,
    formatDaysCsv,
    formatTimeWindow,
} from '.';

describe('daysArrayFromAllowed', () => {
    it('returns 7 trues when allowedDays is null (no restriction).', () => {
        expect(daysArrayFromAllowed(null)).toEqual([true, true, true, true, true, true, true]);
    });

    it('returns 7 falses when allowedDays is empty.', () => {
        expect(daysArrayFromAllowed([])).toEqual([false, false, false, false, false, false, false]);
    });

    it('maps ISO weekday (1=Mon, 7=Sun) to the Sun-first boolean array.', () => {
        // Mon, Wed, Fri → Sun-first: [Sun=F, Mon=T, Tue=F, Wed=T, Thu=F, Fri=T, Sat=F].
        expect(daysArrayFromAllowed([1, 3, 5])).toEqual([false, true, false, true, false, true, false]);
        // Sat, Sun (weekend) → Sun-first: [Sun=T, Mon..Fri=F, Sat=T].
        expect(daysArrayFromAllowed([6, 7])).toEqual([true, false, false, false, false, false, true]);
    });

    it('ignores out-of-range day numbers gracefully.', () => {
        expect(daysArrayFromAllowed([0, 8, 99])).toEqual([false, false, false, false, false, false, false]);
    });
});

describe('formatDaysCsv', () => {
    it('returns Every day when allowedDays is null.', () => {
        expect(formatDaysCsv(null)).toBe('Every day');
    });

    it('returns No days when allowedDays is empty.', () => {
        expect(formatDaysCsv([])).toBe('No days');
    });

    it('joins three-letter day names with a middot.', () => {
        expect(formatDaysCsv([1, 3, 5])).toBe('Mon · Wed · Fri');
        expect(formatDaysCsv([6, 7])).toBe('Sun · Sat');
    });

    it('emits Sun-first week order regardless of input ordering.', () => {
        expect(formatDaysCsv([5, 1, 3])).toBe('Mon · Wed · Fri');
        expect(formatDaysCsv([7, 1])).toBe('Sun · Mon');
    });

    it('de-duplicates repeated weekdays.', () => {
        expect(formatDaysCsv([1, 1, 3, 3])).toBe('Mon · Wed');
    });

    it('skips out-of-range day numbers.', () => {
        expect(formatDaysCsv([0, 1, 8])).toBe('Mon');
    });
});

describe('formatTimeWindow', () => {
    it('returns Any time when allowedTimeWindows is null.', () => {
        expect(formatTimeWindow(null)).toBe('Any time');
    });

    it('returns Any time when allowedTimeWindows is empty.', () => {
        expect(formatTimeWindow([])).toBe('Any time');
    });

    it('formats a single window as `HH:MM → HH:MM`.', () => {
        expect(formatTimeWindow([{ start: '22:00', end: '06:00' }])).toBe('22:00 → 06:00');
    });

    it('comma-joins multiple windows.', () => {
        expect(formatTimeWindow([
            { start: '22:00', end: '06:00' },
            { start: '14:00', end: '15:00' },
        ])).toBe('22:00 → 06:00, 14:00 → 15:00');
    });
});
