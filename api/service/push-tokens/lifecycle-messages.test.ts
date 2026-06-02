import { describe, expect, it } from 'bun:test';
import {
    scheduleEndedMessage,
    scheduleStartedMessage,
    wateringEndedMessage,
    wateringStartedMessage,
} from './lifecycle-messages';

describe('scheduleStartedMessage', () => {
    it('names the night when one is supplied', () => {
        const m = scheduleStartedMessage('2026-06-09');
        expect(m.title).toBe('Irrigation started');
        expect(m.body).toBe('Schedule started for the night of 2026-06-09.');
        expect(m.data).toEqual({ category: 'scheduleStart' });
    });

    it('omits the night when not supplied', () => {
        expect(scheduleStartedMessage().body).toBe('Schedule started.');
    });
});

describe('scheduleEndedMessage', () => {
    it('renders the per-zone summary sorted by zone name', () => {
        const m = scheduleEndedMessage({
            perZoneRuntimeMin: { South: 8.5, North: 12 },
            siteTimezone: 'America/Edmonton',
        });
        expect(m.title).toBe('Irrigation complete');
        expect(m.body).toBe('Watered North 12 min, South 8.5 min.');
        expect(m.data).toEqual({ category: 'scheduleEnd' });
    });

    it('falls back to a generic line when nothing was watered', () => {
        const m = scheduleEndedMessage({ perZoneRuntimeMin: {}, siteTimezone: 'America/Edmonton' });
        expect(m.body).toBe('All cycles complete.');
    });

    it('appends a tz-formatted next-irrigation sentence when one is known', () => {
        const m = scheduleEndedMessage({
            perZoneRuntimeMin: { North: 10 },
            siteTimezone: 'America/Edmonton',
            nextIrrigation: { zoneName: 'South Lawn', startTime: new Date('2026-06-10T03:30:00.000Z') },
        });
        expect(m.body).toMatch(/^Watered North 10 min\. Next irrigation: South Lawn on \w{3} \d{1,2} \w{3} at \d{1,2}:\d{2}(am|pm)\.$/);
    });

    it('omits the next-irrigation sentence when none is supplied', () => {
        const m = scheduleEndedMessage({ perZoneRuntimeMin: { North: 10 }, siteTimezone: 'America/Edmonton' });
        expect(m.body).not.toContain('Next irrigation');
    });
});

describe('wateringStartedMessage', () => {
    it('includes duration and the manual-fire qualifier', () => {
        const m = wateringStartedMessage({ zoneName: 'Tomato', zoneId: 'z-1', durationMin: 15, reason: 'manual' });
        expect(m.title).toBe('Watering started');
        expect(m.body).toBe('Tomato watering started (~15 min) (manual fire).');
        expect(m.data).toEqual({ category: 'wateringStart', zoneId: 'z-1' });
    });

    it('omits the duration when not supplied', () => {
        const m = wateringStartedMessage({ zoneName: 'Tomato', zoneId: 'z-1', reason: 'manual' });
        expect(m.body).toBe('Tomato watering started (manual fire).');
    });

    it('omits the manual qualifier when no reason is given', () => {
        const m = wateringStartedMessage({ zoneName: 'Tomato', zoneId: 'z-1' });
        expect(m.body).toBe('Tomato watering started.');
    });
});

describe('wateringEndedMessage', () => {
    it('uses the shutdown qualifier', () => {
        const m = wateringEndedMessage({ zoneName: 'Tomato', zoneId: 'z-1', reason: 'shutdown' });
        expect(m.body).toBe('Tomato watering ended (closed during daemon shutdown).');
        expect(m.data).toEqual({ category: 'wateringEnd', zoneId: 'z-1' });
    });

    it('uses the manual qualifier', () => {
        expect(wateringEndedMessage({ zoneName: 'Tomato', zoneId: 'z-1', reason: 'manual' }).body)
            .toBe('Tomato watering ended (manual fire).');
    });

    it('omits the qualifier with no reason', () => {
        expect(wateringEndedMessage({ zoneName: 'Tomato', zoneId: 'z-1' }).body)
            .toBe('Tomato watering ended.');
    });
});
