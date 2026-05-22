import { describe, expect, it, spyOn } from 'bun:test';
import type { Database } from '@/db';
import { irrigationCycles, scheduleEntries, zones } from '@/db/schema';
import type { Zone } from '@/models';
import { createManualRepository } from '.';

const OPENED_AT = new Date('2026-05-04T15:00:00.000Z');
const CLOSED_AT = new Date('2026-05-04T15:10:00.000Z');

function buildZone(overrides?: Partial<Zone>): Zone {
    return {
        id: 'zone-001',
        name: 'Front Lawn',
        grassType: { name: 'Kentucky Bluegrass', cropCoefficient: 0.85 },
        soil: { name: 'Loam', availableWaterHoldingCapacityMmPerM: 150, infiltrationRateMmPerHr: 25 },
        rootDepthM: 0.3,
        allowableDepletionFraction: 0.5,
        irrigationEfficiency: 0.8,
        flowRateLPerMin: 15,
        areaM2: 100,
        precipitationRateMmPerHr: 9,
        currentDepletionMm: 12,
        siteId: 'site-A',
        siteTimezone: 'America/Edmonton',
        isEnabled: true,
        homeAssistantEntityId: 'switch.zone_001',
        microclimateFactor: 1,
        location: { lat: 51, lon: -114 },
        ...overrides,
    };
}

type InsertCall = { table: unknown; rows: ReadonlyArray<Record<string, unknown>> };
type UpdateCall = { table: unknown; values: Record<string, unknown>; cond: unknown };

function stubDb(idPlan?: { entryIds?: Array<string | null>; cycleIds?: Array<string | null> }) {
    const inserts: InsertCall[] = [];
    const updates: UpdateCall[] = [];
    let entryIdx = 0;
    let cycleIdx = 0;

    // `null` in the plan means "the insert returned no rows" — must check
    // length explicitly instead of using `??` since `null ?? fallback`
    // resolves to the fallback.
    const planned = (plan: Array<string | null> | undefined, idx: number, fallback: string): string | null => {
        if (plan && idx < plan.length) return plan[idx]!;
        return fallback;
    };

    const runInsertReturning = async (table: unknown, rows: ReadonlyArray<Record<string, unknown>>): Promise<Array<Record<string, unknown>>> => {
        inserts.push({ table, rows });
        if (table === scheduleEntries) {
            const id = planned(idPlan?.entryIds, entryIdx, `entry-${entryIdx + 1}`);
            entryIdx += 1;
            return id === null ? [] : [{ id }];
        }
        if (table === irrigationCycles) {
            const id = planned(idPlan?.cycleIds, cycleIdx, `cycle-${cycleIdx + 1}`);
            cycleIdx += 1;
            return id === null ? [] : [{ id }];
        }
        return [];
    };

    const runUpdateWhere = async (table: unknown, values: Record<string, unknown>, cond: unknown): Promise<void> => {
        updates.push({ table, values, cond });
    };

    const db = {
        insert: (table: unknown) => ({ values: (rows: ReadonlyArray<Record<string, unknown>>) => ({ returning: () => runInsertReturning(table, rows) }) }),
        update: (table: unknown) => ({ set: (values: Record<string, unknown>) => ({ where: (cond: unknown) => runUpdateWhere(table, values, cond) }) }),
    } as unknown as Database;

    return { db, inserts, updates };
}

describe('createManualRepository.writeManualRecord', () => {
    it('inserts a schedule_entries row with source=manual, no schedule, rounded depletion fields', async () => {
        const { db, inserts } = stubDb();
        const repo = createManualRepository(db);

        await repo.writeManualRecord(buildZone(), OPENED_AT, CLOSED_AT, 10);

        const entryInsert = inserts.find(c => c.table === scheduleEntries);
        expect(entryInsert?.rows[0]).toMatchObject({
            zoneId: 'zone-001',
            scheduleId: null,
            date: '2026-05-04',
            source: 'manual',
        });
        // precip=9 mm/hr, duration=10/60 → appliedDepth=1.5, rounded to 1.5.
        expect(entryInsert?.rows[0]?.['appliedDepthMm']).toBeCloseTo(1.5, 1);
        expect(entryInsert?.rows[0]?.['depletionBeforeMm']).toBeCloseTo(12, 1);
        // depletionAfter = max(0, 12 - 1.5 * 0.8) = 10.8 → rounded to 10.8.
        expect(entryInsert?.rows[0]?.['depletionAfterMm']).toBeCloseTo(10.8, 1);
    });

    it('inserts an irrigation_cycles row tied to the returned entry id with the supplied open/close/duration', async () => {
        const { db, inserts } = stubDb({ entryIds: ['entry-X'] });
        const repo = createManualRepository(db);

        await repo.writeManualRecord(buildZone(), OPENED_AT, CLOSED_AT, 15);

        const cycleInsert = inserts.find(c => c.table === irrigationCycles);
        expect(cycleInsert?.rows[0]).toMatchObject({
            scheduleEntryId: 'entry-X',
            durationMin: 15,
            firedAt: OPENED_AT,
            closedAt: CLOSED_AT,
        });
        expect(cycleInsert?.rows[0]?.['startTime']).toEqual(OPENED_AT);
    });

    it('updates zones.currentDepletionMm to the clamped post-fire value and returns the inserted cycle id', async () => {
        const { db, updates } = stubDb({ cycleIds: ['cycle-Y'] });
        const repo = createManualRepository(db);

        const result = await repo.writeManualRecord(buildZone(), OPENED_AT, CLOSED_AT, 10);

        expect(result).toBe('cycle-Y');
        const zoneUpdate = updates.find(u => u.table === zones);
        expect(zoneUpdate?.values).toMatchObject({});
        // depletionAfter = max(0, 12 - 10/60 * 9 * 0.8) = 10.8
        expect(zoneUpdate?.values['currentDepletionMm']).toBeCloseTo(10.8, 1);
    });

    it('returns null with a warn when the schedule-entries insert returns no id', async () => {
        const warn = spyOn(console, 'warn').mockImplementation(() => {});
        try {
            const { db, inserts } = stubDb({ entryIds: [null] });
            const repo = createManualRepository(db);

            const result = await repo.writeManualRecord(buildZone(), OPENED_AT, CLOSED_AT, 10);

            expect(result).toBeNull();
            // No cycle insert when the entry id was missing.
            expect(inserts.some(c => c.table === irrigationCycles)).toBe(false);
            expect(warn).toHaveBeenCalled();
        } finally {
            warn.mockRestore();
        }
    });

    it('falls back to flow-rate / area precipitation when the zone has no precipitationRateMmPerHr', async () => {
        const { db, inserts } = stubDb();
        const repo = createManualRepository(db);
        // flowRate 15 L/min, area 100 m² → 60*(15/100) = 9 mm/hr. Same as the explicit default.
        const zone = buildZone({ precipitationRateMmPerHr: undefined });

        await repo.writeManualRecord(zone, OPENED_AT, CLOSED_AT, 10);

        const entryInsert = inserts.find(c => c.table === scheduleEntries);
        // 10/60 * 9 = 1.5 mm.
        expect(entryInsert?.rows[0]?.['appliedDepthMm']).toBeCloseTo(1.5, 1);
    });

    it('clamps depletionAfter at zero rather than going negative', async () => {
        const { db, inserts, updates } = stubDb();
        const repo = createManualRepository(db);
        // Tiny existing depletion + a long fire that would otherwise overshoot.
        const zone = buildZone({ currentDepletionMm: 0.5 });

        await repo.writeManualRecord(zone, OPENED_AT, CLOSED_AT, 60);

        const entryInsert = inserts.find(c => c.table === scheduleEntries);
        expect(entryInsert?.rows[0]?.['depletionAfterMm']).toBe(0);
        const zoneUpdate = updates.find(u => u.table === zones);
        expect(zoneUpdate?.values['currentDepletionMm']).toBe(0);
    });

    it('returns null when the cycle insert returns no id (cycleId fallback)', async () => {
        const { db } = stubDb({ cycleIds: [null] });
        const repo = createManualRepository(db);

        const result = await repo.writeManualRecord(buildZone(), OPENED_AT, null, 5);

        expect(result).toBeNull();
    });
});

describe('createManualRepository.updateCycleClosedAt', () => {
    it('issues a single UPDATE on irrigation_cycles with the supplied closedAt', async () => {
        const { db, updates } = stubDb();
        const repo = createManualRepository(db);

        await repo.updateCycleClosedAt('cycle-Z', CLOSED_AT);

        expect(updates).toHaveLength(1);
        expect(updates[0]?.table).toBe(irrigationCycles);
        expect(updates[0]?.values).toEqual({ closedAt: CLOSED_AT });
    });
});
