import type { NextRunDto } from '@/api/types/next-run';
import type { ZoneSummary } from '@/api/types/zones';
import { computeZoneStatusCopy } from './zone-status';

function buildZone(overrides?: Partial<ZoneSummary>): ZoneSummary {
    return {
        id: 'z-1',
        slug: 'north',
        name: 'North',
        isEnabled: true,
        grassType: { name: 'Kentucky Bluegrass' },
        soilType: { name: 'Loam' },
        areaM2: 100,
        rootDepthM: 0.3,
        allowableDepletionFraction: 0.5,
        irrigationEfficiency: 0.8,
        microclimateFactor: 1,
        precipitationRateMmPerHr: 14,
        currentDepletionMm: 5,
        rawMm: 22.5,
        lastFiredAt: null,
        lastAppliedMm: null,
        homeAssistantEntityId: 'switch.north_zone',
        patch: 'a',
        ...overrides,
    };
}

function buildNextRun(overrides?: Partial<NextRunDto>): NextRunDto {
    return {
        state: 'scheduled',
        startTime: '2026-05-04T05:00:00.000Z',
        endsAt: '2026-05-04T07:00:00.000Z',
        axisStart: '04:00',
        axisEnd: '08:00',
        sunset: '20:30',
        sunrise: '05:30',
        timezone: 'America/Edmonton',
        zoneOrder: ['north'],
        totalCycles: 1,
        zones: [
            { name: 'North', slug: 'north', patch: 'a', cycles: [{ start: '05:00', durMin: 15 }] },
        ],
        ...overrides,
    };
}

describe('computeZoneStatusCopy', () => {
    it('returns "Within tolerance" when depletion is well below RAW.', () => {
        const zone = buildZone({ currentDepletionMm: 5, rawMm: 22.5 });
        expect(computeZoneStatusCopy(zone, undefined)).toBe('Within tolerance');
    });

    it('returns "Approaching RAW" when depletion is between 80% and 100% of RAW.', () => {
        const zone = buildZone({ currentDepletionMm: 19, rawMm: 22.5 });
        expect(computeZoneStatusCopy(zone, undefined)).toBe('Approaching RAW');
    });

    it('returns "Past RAW" when depletion is at or above RAW.', () => {
        const zone = buildZone({ currentDepletionMm: 27.4, rawMm: 22.5 });
        expect(computeZoneStatusCopy(zone, undefined)).toBe('Past RAW');
    });

    it('appends "· next run at HH:MM" when nextRun has cycles for this zone.', () => {
        const zone = buildZone({ slug: 'north', currentDepletionMm: 27.4, rawMm: 22.5 });
        expect(computeZoneStatusCopy(zone, buildNextRun())).toBe('Past RAW · next run at 05:00');
    });

    it('omits the qualifier when nextRun is undefined.', () => {
        const zone = buildZone({ currentDepletionMm: 27.4, rawMm: 22.5 });
        expect(computeZoneStatusCopy(zone, undefined)).toBe('Past RAW');
    });

    it('omits the qualifier when the zone is absent from nextRun.zones.', () => {
        const zone = buildZone({ slug: 'east', currentDepletionMm: 27.4, rawMm: 22.5 });
        expect(computeZoneStatusCopy(zone, buildNextRun())).toBe('Past RAW');
    });

    it('omits the qualifier when the zone is present but has zero cycles.', () => {
        const zone = buildZone({ slug: 'north', currentDepletionMm: 5, rawMm: 22.5 });
        const nextRun = buildNextRun({
            zones: [{ name: 'North', slug: 'north', patch: 'a', cycles: [] }],
        });
        expect(computeZoneStatusCopy(zone, nextRun)).toBe('Within tolerance');
    });
});
