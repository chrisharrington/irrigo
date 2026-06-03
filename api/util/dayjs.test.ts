import { describe, it, expect } from 'bun:test';
import dayjs from '@/util/dayjs';

describe('@/util/dayjs', () => {
    it('has the utc plugin extended', () => {
        const instant = dayjs.utc('2026-06-01T12:00:00Z');
        expect(instant.isValid()).toBe(true);
        expect(instant.toISOString()).toBe('2026-06-01T12:00:00.000Z');
    });

    it('has the timezone plugin extended', () => {
        // 12:00 UTC is 06:00 in America/Edmonton (MDT, UTC-6) in June.
        const local = dayjs.utc('2026-06-01T12:00:00Z').tz('America/Edmonton');
        expect(local.hour()).toBe(6);
        expect(local.format('YYYY-MM-DD')).toBe('2026-06-01');
    });

    it('has the isoWeek plugin extended', () => {
        // 2026-06-01 is a Monday → isoWeekday 1.
        const isoWeekday = dayjs('2026-06-01').isoWeekday();
        expect(isoWeekday).toBe(1);
    });
});
