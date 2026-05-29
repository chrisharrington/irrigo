import './index';

describe('intl polyfill', () => {
    it('honours the `timeZone` option on `Intl.DateTimeFormat` for named IANA zones (APP-77).', () => {
        // Hermes-on-Android silently ignores `timeZone` without this polyfill,
        // so the dayjs `timezone` plugin no-ops and the next-run hero renders
        // UTC. Asserting that an instant 6 hours past UTC midnight renders
        // hour-component "12" (not "6") in Edmonton (UTC-6 in May) proves
        // the polyfill is wired and active.
        const parts = new Intl.DateTimeFormat('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
            timeZone: 'America/Edmonton',
        }).formatToParts(new Date('2026-05-30T06:06:00.000Z'));
        const hour = parts.find(p => p.type === 'hour')?.value;

        expect(hour).toBe('12');
    });
});
