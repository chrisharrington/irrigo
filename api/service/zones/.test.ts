import { describe, expect, it } from 'bun:test';
import type { LatestZoneFire } from '@/models/zone';
import type { SummaryJoinedRow, ZonesRepository } from '@/repositories/zones';
import { bootZonesService, getZoneSummaries, mapJoinedRowToSummary } from '.';

const NOW = new Date('2026-05-04T12:00:00.000Z');

function summaryRow(overrides?: {
    zone?: Partial<SummaryJoinedRow['zone']>;
    grassType?: Partial<SummaryJoinedRow['grassType']>;
    soilType?: Partial<SummaryJoinedRow['soilType']>;
}): SummaryJoinedRow {
    return {
        zone: {
            id: 'zone-001',
            slug: 'front-lawn',
            patch: 'a',
            siteId: 'site-001',
            name: 'Front Lawn',
            grassTypeId: 'grass-001',
            soilTypeId: 'soil-001',
            rootDepthM: 0.3,
            allowableDepletionFraction: 0.5,
            irrigationEfficiency: 0.8,
            flowRateLPerMin: 15,
            areaM2: 100,
            precipitationRateMmPerHr: 9,
            currentDepletionMm: 0,
            isEnabled: true,
            latitude: 51.0447,
            longitude: -114.0719,
            homeAssistantEntityId: 'switch.zone_1',
            microclimateFactor: 1,
            createdAt: NOW,
            updatedAt: NOW,
            ...overrides?.zone,
        },
        grassType: {
            id: 'grass-001', slug: 'kbg', name: 'KBG', cropCoefficient: 0.85,
            createdAt: NOW, updatedAt: NOW,
            ...overrides?.grassType,
        },
        soilType: {
            id: 'soil-001', slug: 'loam', name: 'Loam',
            availableWaterHoldingCapacityMmPerM: 150, infiltrationRateMmPerHr: 25,
            createdAt: NOW, updatedAt: NOW,
            ...overrides?.soilType,
        },
    };
}

function fakeRepo(impl: Partial<ZonesRepository>): ZonesRepository {
    return {
        loadEnabled: async () => [],
        findById: async () => null,
        count: async () => ({ total: 0, enabled: 0 }),
        loadJoinedRowsForSummary: async () => [],
        loadLatestScheduleEntries: async () => [],
        ...impl,
    };
}

describe('mapJoinedRowToSummary', () => {
    it('computes rawMm as AWHC × rootDepthM × allowableDepletionFraction (rounded to 2 decimals)', () => {
        const row = summaryRow({
            zone: { rootDepthM: 0.3, allowableDepletionFraction: 0.5 },
            soilType: { availableWaterHoldingCapacityMmPerM: 140 },
        });

        const summary = mapJoinedRowToSummary(row, null);

        expect(summary.rawMm).toBe(21);
    });

    it('rounds rawMm to two decimal places', () => {
        const row = summaryRow({
            zone: { rootDepthM: 0.27, allowableDepletionFraction: 0.45 },
            soilType: { availableWaterHoldingCapacityMmPerM: 137 },
        });

        const summary = mapJoinedRowToSummary(row, null);

        expect(summary.rawMm).toBe(16.65);
    });

    it('emits null lastFiredAt and lastAppliedMm when no fire entry is supplied', () => {
        const summary = mapJoinedRowToSummary(summaryRow(), null);

        expect(summary.lastFiredAt).toBeNull();
        expect(summary.lastAppliedMm).toBeNull();
    });

    it('formats lastFiredAt as YYYY-MM-DD and passes through lastAppliedMm', () => {
        const summary = mapJoinedRowToSummary(summaryRow(), {
            zoneId: 'zone-001',
            date: '2026-05-13',
            appliedDepthMm: 14,
        });

        expect(summary.lastFiredAt).toBe('2026-05-13');
        expect(summary.lastAppliedMm).toBe(14);
    });

    it('passes the patch variant through from the zone row', () => {
        const summary = mapJoinedRowToSummary(summaryRow({ zone: { patch: 'b' } }), null);

        expect(summary.patch).toBe('b');
    });

    it('flattens grass and soil into a name-only nested shape', () => {
        const summary = mapJoinedRowToSummary(summaryRow({
            grassType: { name: 'Bermudagrass' },
            soilType: { name: 'Sandy Loam' },
        }), null);

        expect(summary.grassType).toEqual({ name: 'Bermudagrass' });
        expect(summary.soilType).toEqual({ name: 'Sandy Loam' });
    });

    it('preserves identity, depletion, and HA fields verbatim', () => {
        const summary = mapJoinedRowToSummary(summaryRow({
            zone: {
                id: 'zone-007',
                slug: 'back-yard',
                name: 'Back Yard',
                isEnabled: false,
                currentDepletionMm: 18.4,
                homeAssistantEntityId: 'switch.back_yard',
                precipitationRateMmPerHr: 12.5,
            },
        }), null);

        expect(summary.id).toBe('zone-007');
        expect(summary.slug).toBe('back-yard');
        expect(summary.name).toBe('Back Yard');
        expect(summary.isEnabled).toBe(false);
        expect(summary.currentDepletionMm).toBe(18.4);
        expect(summary.homeAssistantEntityId).toBe('switch.back_yard');
        expect(summary.precipitationRateMmPerHr).toBe(12.5);
    });

    it('emits null for missing homeAssistantEntityId and precipitationRateMmPerHr', () => {
        const summary = mapJoinedRowToSummary(summaryRow({
            zone: { homeAssistantEntityId: null, precipitationRateMmPerHr: null },
        }), null);

        expect(summary.homeAssistantEntityId).toBeNull();
        expect(summary.precipitationRateMmPerHr).toBeNull();
    });
});

describe('getZoneSummaries', () => {
    it('returns the full summary list with rawMm and last-fire merged in by zone id', async () => {
        const rows = [
            summaryRow({
                zone: { id: 'zone-1', name: 'North', rootDepthM: 0.3, allowableDepletionFraction: 0.5 },
                soilType: { availableWaterHoldingCapacityMmPerM: 140 },
            }),
            summaryRow({
                zone: { id: 'zone-2', name: 'South', rootDepthM: 0.2, allowableDepletionFraction: 0.45 },
                soilType: { availableWaterHoldingCapacityMmPerM: 140 },
            }),
        ];
        const entries: LatestZoneFire[] = [
            { zoneId: 'zone-1', date: '2026-05-13', appliedDepthMm: 14 },
        ];
        bootZonesService({
            repo: fakeRepo({
                loadJoinedRowsForSummary: async () => rows,
                loadLatestScheduleEntries: async () => entries,
            }),
        });

        const result = await getZoneSummaries();

        expect(result).toHaveLength(2);
        expect(result[0]?.name).toBe('North');
        expect(result[0]?.rawMm).toBe(21);
        expect(result[0]?.lastFiredAt).toBe('2026-05-13');
        expect(result[0]?.lastAppliedMm).toBe(14);
        expect(result[1]?.name).toBe('South');
        expect(result[1]?.lastFiredAt).toBeNull();
        expect(result[1]?.lastAppliedMm).toBeNull();
    });

    it('returns an empty array when no zones exist', async () => {
        bootZonesService({
            repo: fakeRepo({
                loadJoinedRowsForSummary: async () => [],
                loadLatestScheduleEntries: async () => [],
            }),
        });

        const result = await getZoneSummaries();

        expect(result).toEqual([]);
    });

    it('emits null last-fire fields for every zone when no entries exist', async () => {
        bootZonesService({
            repo: fakeRepo({
                loadJoinedRowsForSummary: async () => [summaryRow({ zone: { id: 'zone-1' } })],
                loadLatestScheduleEntries: async () => [],
            }),
        });

        const result = await getZoneSummaries();

        expect(result).toHaveLength(1);
        expect(result[0]?.lastFiredAt).toBeNull();
        expect(result[0]?.lastAppliedMm).toBeNull();
    });
});
