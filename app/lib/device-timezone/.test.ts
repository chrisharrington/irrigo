import { getDeviceTimezoneAbbreviation } from '.';

// The test environment pins TZ=America/Edmonton (see jest-setup.ts), so the
// abbreviation tracks Mountain time: MDT in summer, MST in winter.
describe('getDeviceTimezoneAbbreviation', () => {
    it('returns the daylight abbreviation for a summer instant.', () => {
        // 2026-06-11 is well inside Mountain Daylight Time.
        expect(getDeviceTimezoneAbbreviation(new Date('2026-06-11T12:00:00.000Z'))).toBe('MDT');
    });

    it('returns the standard abbreviation for a winter instant.', () => {
        // 2026-01-15 is Mountain Standard Time.
        expect(getDeviceTimezoneAbbreviation(new Date('2026-01-15T12:00:00.000Z'))).toBe('MST');
    });
});
