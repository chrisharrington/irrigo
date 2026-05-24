import { getSiteTimezone } from '.';

describe('getSiteTimezone', () => {
    const saved = process.env.EXPO_PUBLIC_SITE_TIMEZONE;

    afterEach(() => {
        if (saved === undefined) delete process.env.EXPO_PUBLIC_SITE_TIMEZONE;
        else process.env.EXPO_PUBLIC_SITE_TIMEZONE = saved;
    });

    it('falls back to America/Edmonton when the env var is unset.', () => {
        delete process.env.EXPO_PUBLIC_SITE_TIMEZONE;

        expect(getSiteTimezone()).toBe('America/Edmonton');
    });

    it('falls back to the default when the env var is blank.', () => {
        process.env.EXPO_PUBLIC_SITE_TIMEZONE = '   ';

        expect(getSiteTimezone()).toBe('America/Edmonton');
    });

    it('returns the env var value when it is set.', () => {
        process.env.EXPO_PUBLIC_SITE_TIMEZONE = 'America/New_York';

        expect(getSiteTimezone()).toBe('America/New_York');
    });
});
