import { formatRelativeTime } from '.';

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
