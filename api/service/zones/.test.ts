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
        loadLatestFires: async () => [],
        ...impl,
    };
}

describe('mapJoinedRowToSummary', () => {
    it('computes rawMm as AWHC × rootDepthM × allowableDepletionFraction (rounded to 2 decimals)', () => {
        const row = summaryRow({
            zone: { rootDepthM: 0.3, allowableDepletionFraction: 0.5 },
            soilType: { availableWaterHoldingCapacityMmPerM: 140 },
        });

        const summary = mapJoinedRowToSummary(row, null, null);

        expect(summary.rawMm).toBe(21);
    });

    it('rounds rawMm to two decimal places', () => {
        const row = summaryRow({
            zone: { rootDepthM: 0.27, allowableDepletionFraction: 0.45 },
            soilType: { availableWaterHoldingCapacityMmPerM: 137 },
        });

        const summary = mapJoinedRowToSummary(row, null, null);

        expect(summary.rawMm).toBe(16.65);
    });

    it('emits null lastFiredAt and lastAppliedMm when no fire entry is supplied', () => {
        const summary = mapJoinedRowToSummary(summaryRow(), null, null);

        expect(summary.lastFiredAt).toBeNull();
        expect(summary.lastAppliedMm).toBeNull();
    });

    it('serialises lastFiredAt as an ISO-8601 UTC timestamp and passes through lastAppliedMm', () => {
        const summary = mapJoinedRowToSummary(summaryRow(), {
            zoneId: 'zone-001',
            firedAt: new Date('2026-05-13T05:00:00.000Z'),
            appliedDepthMm: 14,
        }, null);

        expect(summary.lastFiredAt).toBe('2026-05-13T05:00:00.000Z');
        expect(summary.lastAppliedMm).toBe(14);
    });

    it('passes the patch variant through from the zone row', () => {
        const summary = mapJoinedRowToSummary(summaryRow({ zone: { patch: 'b' } }), null, null);

        expect(summary.patch).toBe('b');
    });

    it('flattens grass and soil into a name-only nested shape', () => {
        const summary = mapJoinedRowToSummary(summaryRow({
            grassType: { name: 'Bermudagrass' },
            soilType: { name: 'Sandy Loam' },
        }), null, null);

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
        }), null, null);

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
        }), null, null);

        expect(summary.homeAssistantEntityId).toBeNull();
        expect(summary.precipitationRateMmPerHr).toBeNull();
    });

    it('emits isRunning: false and willCloseAt: null when no manual fire is active', () => {
        const summary = mapJoinedRowToSummary(summaryRow(), null, null);

        expect(summary.isRunning).toBe(false);
        expect(summary.willCloseAt).toBeNull();
    });

    it('emits isRunning: false and willCloseAt: null when a different zone is firing', () => {
        const summary = mapJoinedRowToSummary(summaryRow({ zone: { id: 'zone-001' } }), null, {
            zoneId: 'zone-other',
            zoneName: 'Other',
            since: new Date('2026-05-13T05:00:00.000Z'),
            willCloseAt: new Date('2026-05-13T05:15:00.000Z'),
        });

        expect(summary.isRunning).toBe(false);
        expect(summary.willCloseAt).toBeNull();
    });

    it('emits isRunning: true and the ISO willCloseAt when the row matches a timed run', () => {
        const summary = mapJoinedRowToSummary(summaryRow({ zone: { id: 'zone-001' } }), null, {
            zoneId: 'zone-001',
            zoneName: 'Front Lawn',
            since: new Date('2026-05-13T05:00:00.000Z'),
            willCloseAt: new Date('2026-05-13T05:15:00.000Z'),
        });

        expect(summary.isRunning).toBe(true);
        expect(summary.willCloseAt).toBe('2026-05-13T05:15:00.000Z');
    });

    it('emits isRunning: true and willCloseAt: null when the row matches a bare open (no auto-close)', () => {
        const summary = mapJoinedRowToSummary(summaryRow({ zone: { id: 'zone-001' } }), null, {
            zoneId: 'zone-001',
            zoneName: 'Front Lawn',
            since: new Date('2026-05-13T05:00:00.000Z'),
            willCloseAt: null,
        });

        expect(summary.isRunning).toBe(true);
        expect(summary.willCloseAt).toBeNull();
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
            { zoneId: 'zone-1', firedAt: new Date('2026-05-13T05:00:00.000Z'), appliedDepthMm: 14 },
        ];
        bootZonesService({
            repo: fakeRepo({
                loadJoinedRowsForSummary: async () => rows,
                loadLatestFires: async () => entries,
            }),
        });

        const result = await getZoneSummaries(null);

        expect(result).toHaveLength(2);
        expect(result[0]?.name).toBe('North');
        expect(result[0]?.rawMm).toBe(21);
        expect(result[0]?.lastFiredAt).toBe('2026-05-13T05:00:00.000Z');
        expect(result[0]?.lastAppliedMm).toBe(14);
        expect(result[1]?.name).toBe('South');
        expect(result[1]?.lastFiredAt).toBeNull();
        expect(result[1]?.lastAppliedMm).toBeNull();
    });

    it('returns an empty array when no zones exist', async () => {
        bootZonesService({
            repo: fakeRepo({
                loadJoinedRowsForSummary: async () => [],
                loadLatestFires: async () => [],
            }),
        });

        const result = await getZoneSummaries(null);

        expect(result).toEqual([]);
    });

    it('emits null last-fire fields for every zone when no entries exist', async () => {
        bootZonesService({
            repo: fakeRepo({
                loadJoinedRowsForSummary: async () => [summaryRow({ zone: { id: 'zone-1' } })],
                loadLatestFires: async () => [],
            }),
        });

        const result = await getZoneSummaries(null);

        expect(result).toHaveLength(1);
        expect(result[0]?.lastFiredAt).toBeNull();
        expect(result[0]?.lastAppliedMm).toBeNull();
    });

    it('flips isRunning on the matching zone and leaves siblings untouched when a snapshot is passed', async () => {
        bootZonesService({
            repo: fakeRepo({
                loadJoinedRowsForSummary: async () => [
                    summaryRow({ zone: { id: 'zone-1', name: 'North' } }),
                    summaryRow({ zone: { id: 'zone-2', name: 'South' } }),
                ],
                loadLatestFires: async () => [],
            }),
        });

        const result = await getZoneSummaries({
            zoneId: 'zone-2',
            zoneName: 'South',
            since: new Date('2026-05-13T05:00:00.000Z'),
            willCloseAt: new Date('2026-05-13T05:15:00.000Z'),
        });

        expect(result[0]?.isRunning).toBe(false);
        expect(result[0]?.willCloseAt).toBeNull();
        expect(result[1]?.isRunning).toBe(true);
        expect(result[1]?.willCloseAt).toBe('2026-05-13T05:15:00.000Z');
    });
});
