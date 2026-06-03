import { describe, expect, it } from 'bun:test';
import dayjs from '@/util/dayjs';
import { computeNextMorningAt, computeNextRePlanAt, pickNextTick, pickUpcomingSunrise } from '.';

describe('computeNextRePlanAt', () => {
    it('UTC: returns todays hour when the current time is before that hour', () => {
        const now = new Date('2026-05-04T01:30:00.000Z');
        const next = computeNextRePlanAt(now, 4, 'UTC');

        expect(next.toISOString()).toBe('2026-05-04T04:00:00.000Z');
    });

    it('UTC: returns tomorrows hour when the current time is past todays hour', () => {
        const now = new Date('2026-05-04T18:30:00.000Z');
        const next = computeNextRePlanAt(now, 4, 'UTC');

        expect(next.toISOString()).toBe('2026-05-05T04:00:00.000Z');
    });

    it('UTC: returns tomorrows hour when the current time exactly matches todays hour', () => {
        const now = new Date('2026-05-04T04:00:00.000Z');
        const next = computeNextRePlanAt(now, 4, 'UTC');

        expect(next.toISOString()).toBe('2026-05-05T04:00:00.000Z');
    });

    it('Edmonton MDT: maps local 04:00 to the correct UTC instant when now is before it', () => {
        const now = new Date('2026-05-04T01:30:00.000Z');
        const next = computeNextRePlanAt(now, 4, 'America/Edmonton');

        expect(next.toISOString()).toBe('2026-05-04T10:00:00.000Z');
    });

    it('Edmonton MDT: rolls to tomorrow when now is past local 04:00', () => {
        const now = new Date('2026-05-04T18:30:00.000Z');
        const next = computeNextRePlanAt(now, 4, 'America/Edmonton');

        expect(next.toISOString()).toBe('2026-05-05T10:00:00.000Z');
    });

    it('Edmonton MST: maps local 04:00 to the correct UTC instant outside DST', () => {
        const now = new Date('2026-01-15T18:30:00.000Z');
        const next = computeNextRePlanAt(now, 4, 'America/Edmonton');

        expect(next.toISOString()).toBe('2026-01-16T11:00:00.000Z');
    });
});

describe('computeNextMorningAt', () => {
    it('returns sunrise + offset minutes when that instant is in the future', () => {
        const now = new Date('2026-05-24T04:00:00.000Z');
        const sunrise = new Date('2026-05-24T11:41:00.000Z');
        const next = computeNextMorningAt(now, sunrise, 60);

        expect(next?.toISOString()).toBe('2026-05-24T12:41:00.000Z');
    });

    it('returns null when sunrise is null (no anchor known yet)', () => {
        const next = computeNextMorningAt(new Date('2026-05-24T04:00:00.000Z'), null, 60);

        expect(next).toBeNull();
    });

    it('returns null when sunrise + offset is already in the past', () => {
        const now = new Date('2026-05-24T18:00:00.000Z');
        const sunrise = new Date('2026-05-24T11:41:00.000Z');
        const next = computeNextMorningAt(now, sunrise, 60);

        expect(next).toBeNull();
    });

    it('respects a non-default offset', () => {
        const now = new Date('2026-05-24T04:00:00.000Z');
        const sunrise = new Date('2026-05-24T11:41:00.000Z');
        const next = computeNextMorningAt(now, sunrise, 30);

        expect(next?.toISOString()).toBe('2026-05-24T12:11:00.000Z');
    });
});

describe('pickUpcomingSunrise', () => {
    it('returns null for an empty daily array', () => {
        const result = pickUpcomingSunrise([], new Date('2026-05-24T04:00:00Z'), 60);

        expect(result).toBeNull();
    });

    it('returns the first sunrise whose +offset is still in the future', () => {
        const daily = [
            { sunrise: dayjs('2026-05-24T11:41:00Z') },
            { sunrise: dayjs('2026-05-25T11:40:00Z') },
        ];
        const at = new Date('2026-05-24T04:00:00Z');

        const result = pickUpcomingSunrise(daily, at, 60);

        expect(result?.toISOString()).toBe('2026-05-24T11:41:00.000Z');
    });

    it('skips a past sunrise and falls through to tomorrows', () => {
        const daily = [
            { sunrise: dayjs('2026-05-24T11:41:00Z') }, // 11:41 + 60 = 12:41 — already past at 18:00
            { sunrise: dayjs('2026-05-25T11:40:00Z') },
        ];
        const at = new Date('2026-05-24T18:00:00Z');

        const result = pickUpcomingSunrise(daily, at, 60);

        expect(result?.toISOString()).toBe('2026-05-25T11:40:00.000Z');
    });

    it('returns null when all sunrises are in the past', () => {
        const daily = [
            { sunrise: dayjs('2026-05-23T11:41:00Z') },
            { sunrise: dayjs('2026-05-24T11:41:00Z') },
        ];
        const at = new Date('2026-05-24T18:00:00Z');

        const result = pickUpcomingSunrise(daily, at, 60);

        expect(result).toBeNull();
    });

    it('honours the offset threshold exactly (boundary)', () => {
        const sunrise = dayjs('2026-05-24T11:41:00Z');
        const daily = [{ sunrise }];

        // sunrise+60min = 12:41. At exactly 12:41 the candidate should NOT
        // qualify (the past-or-equal check uses `<=`).
        const atEqual = new Date('2026-05-24T12:41:00.000Z');
        expect(pickUpcomingSunrise(daily, atEqual, 60)).toBeNull();

        // One millisecond earlier — still in the future.
        const atJustBefore = new Date('2026-05-24T12:40:59.999Z');
        expect(pickUpcomingSunrise(daily, atJustBefore, 60)?.toISOString()).toBe('2026-05-24T11:41:00.000Z');
    });

    it('ignores entries with no sunrise field', () => {
        const daily = [
            {},
            { sunrise: dayjs('2026-05-24T11:41:00Z') },
        ];

        const result = pickUpcomingSunrise(daily, new Date('2026-05-24T04:00:00Z'), 60);

        expect(result?.toISOString()).toBe('2026-05-24T11:41:00.000Z');
    });
});

describe('pickNextTick', () => {
    it('returns morning when the morning tick fires before the next evening', () => {
        const result = pickNextTick({
            now: new Date('2026-05-04T04:00:00Z'),
            eveningHourLocal: 20,
            siteTimezone: 'UTC',
            latestKnownSunrise: new Date('2026-05-04T11:41:00Z'),
            morningOffsetMinutes: 60,
        });

        expect(result.kind).toBe('morning');
        expect(result.at.toISOString()).toBe('2026-05-04T12:41:00.000Z');
    });

    it('returns evening when no sunrise anchor is known', () => {
        const result = pickNextTick({
            now: new Date('2026-05-04T04:00:00Z'),
            eveningHourLocal: 20,
            siteTimezone: 'UTC',
            latestKnownSunrise: null,
            morningOffsetMinutes: 60,
        });

        expect(result.kind).toBe('evening');
        expect(result.at.toISOString()).toBe('2026-05-04T20:00:00.000Z');
    });

    it('returns evening when the morning tick has already passed', () => {
        const result = pickNextTick({
            now: new Date('2026-05-04T15:00:00Z'),
            eveningHourLocal: 20,
            siteTimezone: 'UTC',
            latestKnownSunrise: new Date('2026-05-04T11:41:00Z'),
            morningOffsetMinutes: 60,
        });

        expect(result.kind).toBe('evening');
        expect(result.at.toISOString()).toBe('2026-05-04T20:00:00.000Z');
    });

    it('returns morning when the evening tick is later than the next morning', () => {
        // After 20:00 the next evening tick is tomorrow. If tomorrow's
        // morning tick fires before tomorrow's evening, morning wins.
        const result = pickNextTick({
            now: new Date('2026-05-04T21:00:00Z'),
            eveningHourLocal: 20,
            siteTimezone: 'UTC',
            latestKnownSunrise: new Date('2026-05-05T11:41:00Z'),
            morningOffsetMinutes: 60,
        });

        expect(result.kind).toBe('morning');
        expect(result.at.toISOString()).toBe('2026-05-05T12:41:00.000Z');
    });
});
