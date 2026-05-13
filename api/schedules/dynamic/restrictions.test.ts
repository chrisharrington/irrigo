import dayjs from 'dayjs';
import { describe, it, expect } from 'bun:test';
import {
    computeAllowedIntervalsForDay,
    computeForbiddenIntervalsForDay,
    type ScheduleRestrictions,
} from './restrictions';

const BASE_DAY = dayjs('2026-05-13T00:00:00.000Z');
const SUNRISE = BASE_DAY.hour(5).minute(30).second(0).millisecond(0);

const MUNICIPAL_WINDOWS: ScheduleRestrictions = {
    allowedDays: null,
    allowedTimeWindows: [
        { start: '00:00', end: '10:00' },
        { start: '19:00', end: '23:59' },
    ],
};

describe('computeAllowedIntervalsForDay — endBySunrise flag', () => {
    it('leaves intervals unchanged when endBySunrise is false', () => {
        const restrictions: ScheduleRestrictions = { ...MUNICIPAL_WINDOWS, endBySunrise: false };
        const intervals = computeAllowedIntervalsForDay(BASE_DAY, restrictions, SUNRISE);

        expect(intervals).toHaveLength(2);
        expect(intervals[0]!.start.format('HH:mm')).toBe('00:00');
        expect(intervals[0]!.end.format('HH:mm')).toBe('10:00');
        expect(intervals[1]!.start.format('HH:mm')).toBe('19:00');
        expect(intervals[1]!.end.format('HH:mm')).toBe('23:59');
    });

    it('leaves intervals unchanged when endBySunrise is absent', () => {
        const intervals = computeAllowedIntervalsForDay(BASE_DAY, MUNICIPAL_WINDOWS, SUNRISE);

        expect(intervals).toHaveLength(2);
        expect(intervals[0]!.end.format('HH:mm')).toBe('10:00');
    });

    it('narrows morning window end to sunrise when endBySunrise is true', () => {
        const restrictions: ScheduleRestrictions = { ...MUNICIPAL_WINDOWS, endBySunrise: true };
        const intervals = computeAllowedIntervalsForDay(BASE_DAY, restrictions, SUNRISE);

        expect(intervals).toHaveLength(2);
        expect(intervals[0]!.start.format('HH:mm')).toBe('00:00');
        expect(intervals[0]!.end.format('HH:mm')).toBe('05:30');
    });

    it('leaves evening window unchanged when endBySunrise is true', () => {
        const restrictions: ScheduleRestrictions = { ...MUNICIPAL_WINDOWS, endBySunrise: true };
        const intervals = computeAllowedIntervalsForDay(BASE_DAY, restrictions, SUNRISE);

        const evening = intervals.find(i => i.start.hour() >= 19);
        expect(evening).toBeDefined();
        expect(evening!.start.format('HH:mm')).toBe('19:00');
        expect(evening!.end.format('HH:mm')).toBe('23:59');
    });

    it('leaves a window entirely before sunrise unchanged', () => {
        const restrictions: ScheduleRestrictions = {
            allowedDays: null,
            allowedTimeWindows: [{ start: '00:00', end: '04:00' }],
            endBySunrise: true,
        };
        const intervals = computeAllowedIntervalsForDay(BASE_DAY, restrictions, SUNRISE);

        expect(intervals).toHaveLength(1);
        expect(intervals[0]!.start.format('HH:mm')).toBe('00:00');
        expect(intervals[0]!.end.format('HH:mm')).toBe('04:00');
    });

    it('keeps a window starting at sunrise as-is (start not before sunrise)', () => {
        const restrictions: ScheduleRestrictions = {
            allowedDays: null,
            allowedTimeWindows: [{ start: '05:30', end: '08:00' }],
            endBySunrise: true,
        };
        const intervals = computeAllowedIntervalsForDay(BASE_DAY, restrictions, SUNRISE);

        expect(intervals).toHaveLength(1);
        expect(intervals[0]!.start.format('HH:mm')).toBe('05:30');
        expect(intervals[0]!.end.format('HH:mm')).toBe('08:00');
    });
});

describe('computeForbiddenIntervalsForDay — endBySunrise flag', () => {
    it('includes the post-sunrise morning stretch as a forbidden gap when endBySunrise is true', () => {
        const restrictions: ScheduleRestrictions = { ...MUNICIPAL_WINDOWS, endBySunrise: true };
        const forbidden = computeForbiddenIntervalsForDay(BASE_DAY, restrictions, SUNRISE);

        // Expected gaps:
        //   midnight–midnight (full day) minus [00:00–05:30] and [19:00–23:59]
        //   → [05:30–19:00] and [23:59–midnight]
        const postSunrise = forbidden.find(f =>
            f.start.format('HH:mm') === '05:30' && f.end.format('HH:mm') === '19:00');
        expect(postSunrise).toBeDefined();
    });

    it('does not include post-sunrise stretch as forbidden when endBySunrise is false', () => {
        const restrictions: ScheduleRestrictions = { ...MUNICIPAL_WINDOWS, endBySunrise: false };
        const forbidden = computeForbiddenIntervalsForDay(BASE_DAY, restrictions, SUNRISE);

        // Without the flag, morning window is 00:00–10:00 so the gap after it starts at 10:00
        const postSunrise = forbidden.find(f => f.start.format('HH:mm') === '05:30');
        expect(postSunrise).toBeUndefined();
    });
});
