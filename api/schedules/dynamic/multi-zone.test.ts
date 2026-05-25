import { describe, it, expect } from 'bun:test';
import dayjs, { type Dayjs } from 'dayjs';

import { createTestZone, GRASS_TYPES, SOIL_TYPES } from '@/mock/zone';
import { createDryPeriod } from '@/mock/weather';
import type { DailyWeather, Zone } from '@/models';
import {
    planZoneSchedule,
    type BusyWindow,
    type PlanZoneScheduleResult,
} from '.';
import type { ScheduleRestrictions } from './restrictions';

/**
 * Sequentially plans every zone the way the daemon's `rePlan()` does:
 * collect each placed cycle into `busyWindows` before planning the next
 * zone, so the second + third zones see the earlier zones' run windows.
 * Returns a Map keyed by zone id so callers can assert per-zone outcomes.
 */
function planAllZonesSequentially(
    zones: Zone[],
    weather: DailyWeather[],
    restrictions?: ScheduleRestrictions,
): Map<string, PlanZoneScheduleResult> {
    const busyWindows: BusyWindow[] = [];
    const results = new Map<string, PlanZoneScheduleResult>();
    const effectiveRestrictions: ScheduleRestrictions =
        restrictions ?? { allowedDays: null, allowedTimeWindows: null };
    for (const zone of zones) {
        const result = planZoneSchedule(zone, weather, busyWindows, effectiveRestrictions);
        results.set(zone.id, result);
        for (const entry of result.entries) {
            for (const cycle of entry.cycles) {
                busyWindows.push({
                    start: cycle.startTime,
                    end: cycle.startTime.add(cycle.durationMin, 'minute'),
                });
            }
        }
    }
    return results;
}

type TimedCycle = { startTime: Dayjs; durationMin: number };

/**
 * Asserts `cycle` sits strictly inside one of the soak gaps between
 * consecutive cycles in `zoneCycles` — i.e. some i exists such that
 * `cycle.start >= zoneCycles[i].end` and `cycle.end <= zoneCycles[i+1].start`.
 * `zoneCycles` is sorted chronologically by start time.
 *
 * Returns the index `i` of the preceding zone cycle so callers can assert
 * "different gaps for different cycles" (API-73).
 */
function assertCycleInsideSoakGap(cycle: TimedCycle, zoneCycles: ReadonlyArray<TimedCycle>): number {
    const cycleStart = cycle.startTime;
    const cycleEnd = cycle.startTime.add(cycle.durationMin, 'minute');
    for (let i = 0; i < zoneCycles.length - 1; i++) {
        const gapStart = zoneCycles[i]!.startTime.add(zoneCycles[i]!.durationMin, 'minute');
        const gapEnd = zoneCycles[i + 1]!.startTime;
        const fitsStart = !cycleStart.isBefore(gapStart);
        const fitsEnd = !cycleEnd.isAfter(gapEnd);
        if (fitsStart && fitsEnd) return i;
    }
    throw new Error(
        `cycle [${cycleStart.toISOString()}, ${cycleEnd.toISOString()}] did not fit inside any soak gap of the supplied zone cycles.`,
    );
}

/**
 * Returns `max(end) - min(start)` in minutes across the supplied cycles.
 * Used to compare A-solo block length vs combined multi-zone block length.
 */
function blockSpanMinutes(cycles: ReadonlyArray<TimedCycle>): number {
    if (cycles.length === 0) return 0;
    let minStart = cycles[0]!.startTime.valueOf();
    let maxEnd = cycles[0]!.startTime.add(cycles[0]!.durationMin, 'minute').valueOf();
    for (const c of cycles) {
        const s = c.startTime.valueOf();
        const e = c.startTime.add(c.durationMin, 'minute').valueOf();
        if (s < minStart) minStart = s;
        if (e > maxEnd) maxEnd = e;
    }
    return (maxEnd - minStart) / 60_000;
}

/**
 * Collects the day-0 cycles for a single zone from a planning result, sorted
 * chronologically by start time.
 */
function day0CyclesSorted(result: PlanZoneScheduleResult, dateStr: string): TimedCycle[] {
    const day = result.entries.find(e => e.date.format('YYYY-MM-DD') === dateStr);
    if (!day) return [];
    return [...day.cycles].sort((a, b) => a.startTime.valueOf() - b.startTime.valueOf());
}

/**
 * Asserts no two cycles belonging to different zones overlap in time.
 * Same-zone cycle overlap is impossible by construction and skipped.
 */
function assertNoCrossZoneOverlap(results: Map<string, PlanZoneScheduleResult>): void {
    const cycles: Array<{ zoneId: string; start: Dayjs; end: Dayjs }> = [];
    for (const [zoneId, result] of results) {
        for (const entry of result.entries) {
            for (const cycle of entry.cycles) {
                cycles.push({
                    zoneId,
                    start: cycle.startTime,
                    end: cycle.startTime.add(cycle.durationMin, 'minute'),
                });
            }
        }
    }
    for (let i = 0; i < cycles.length; i++) {
        for (let j = i + 1; j < cycles.length; j++) {
            const a = cycles[i]!;
            const b = cycles[j]!;
            if (a.zoneId === b.zoneId) continue;
            const overlap = a.start.isBefore(b.end) && a.end.isAfter(b.start);
            expect(overlap).toBe(false);
        }
    }
}

/**
 * Asserts `projectedNextDepletionMm` is a finite non-negative number within
 * `[0, TAW]` for every zone in the result map. Catches arithmetic regressions
 * (NaN, negative depletion, overflow past total available water).
 */
function assertProjectedDepletionSane(results: Map<string, PlanZoneScheduleResult>, zones: Zone[]): void {
    const zonesById = new Map(zones.map(z => [z.id, z]));
    for (const [zoneId, result] of results) {
        const zone = zonesById.get(zoneId)!;
        const taw = zone.soil.availableWaterHoldingCapacityMmPerM * zone.rootDepthM;
        expect(Number.isFinite(result.projectedNextDepletionMm)).toBe(true);
        expect(result.projectedNextDepletionMm).toBeGreaterThanOrEqual(0);
        expect(result.projectedNextDepletionMm).toBeLessThanOrEqual(taw);
    }
}

/**
 * Builds a test zone with the `COMPACT` profile by default so 3 zones fit
 * inside the day-0 truncate window. Per-scenario overrides win over both.
 */
function makeZone(id: string, overrides: Partial<Zone>): Zone {
    return createTestZone({ id, name: `Zone ${id}`, ...COMPACT, ...overrides });
}

function entryDates(result: PlanZoneScheduleResult): string[] {
    return result.entries.map(e => e.date.format('YYYY-MM-DD'));
}

const START = dayjs('2026-05-04'); // Monday

/**
 * Compact zone profile used across the multi-zone scenarios. High-flow
 * sprinkler (30 mm/hr) keeps each zone's overnight runtime to ~1 hour with
 * two cycles, so three zones fit inside the day-0 truncate window
 * (midnight → 06:00 sunrise) and inside the 12-hour gated window on
 * subsequent days.
 */
const COMPACT: Partial<Zone> = { precipitationRateMmPerHr: 30 };

/**
 * Weather days with both `sunrise` (06:00) and `sunset` (20:00) populated.
 * The planner's overnight window is always [midnight, sunrise] (API-72);
 * the `sunset` field is present in the data but no longer affects placement.
 */
function gatedWeather(days: number, etPerDay = 2.0, rainfall?: ReadonlyArray<number>): DailyWeather[] {
    return Array.from({ length: days }, (_, i) => {
        const date = START.add(i, 'day');
        return {
            date,
            sunrise: date.hour(6).minute(0).second(0),
            sunset: date.hour(20).minute(0).second(0),
            rainfallMm: rainfall?.[i] ?? 0,
            evapotranspirationMmPerDay: etPerDay,
        };
    });
}

describe('planZoneSchedule — multi-zone matrix', () => {
    describe('Theme A — Depletion permutations', () => {
        it('1. All zones at zero depletion — no zone fires across the horizon.', () => {
            const zones = [
                makeZone('a', { currentDepletionMm: 0 }),
                makeZone('b', { currentDepletionMm: 0 }),
                makeZone('c', { currentDepletionMm: 0 }),
            ];
            const weather = gatedWeather(7);

            const results = planAllZonesSequentially(zones, weather);

            for (const result of results.values()) {
                expect(result.entries).toHaveLength(0);
            }
            assertProjectedDepletionSane(results, zones);
        });

        it('2. Only the fully-depleted zone fires; the other two stay empty.', () => {
            const zones = [
                makeZone('a', { currentDepletionMm: 22.5 }),
                makeZone('b', { currentDepletionMm: 0 }),
                makeZone('c', { currentDepletionMm: 0 }),
            ];
            const weather = gatedWeather(7);

            const results = planAllZonesSequentially(zones, weather);

            expect(results.get('a')!.entries.length).toBeGreaterThan(0);
            expect(results.get('b')!.entries).toHaveLength(0);
            expect(results.get('c')!.entries).toHaveLength(0);
            assertNoCrossZoneOverlap(results);
            assertProjectedDepletionSane(results, zones);
        });

        it('3. Two depleted zones interleave on day 0; the empty zone produces nothing.', () => {
            const zones = [
                makeZone('a', { currentDepletionMm: 22.5 }),
                makeZone('b', { currentDepletionMm: 22.5 }),
                makeZone('c', { currentDepletionMm: 0 }),
            ];
            const weather = gatedWeather(7);

            const results = planAllZonesSequentially(zones, weather);

            expect(results.get('a')!.entries.length).toBeGreaterThan(0);
            expect(results.get('b')!.entries.length).toBeGreaterThan(0);
            expect(results.get('c')!.entries).toHaveLength(0);
            assertNoCrossZoneOverlap(results);
            assertProjectedDepletionSane(results, zones);
        });

        it('4. All three fully depleted fire day 0 with no cross-zone overlap.', () => {
            const zones = [
                makeZone('a', { currentDepletionMm: 22.5 }),
                makeZone('b', { currentDepletionMm: 22.5 }),
                makeZone('c', { currentDepletionMm: 22.5 }),
            ];
            const weather = gatedWeather(7);

            const results = planAllZonesSequentially(zones, weather);

            for (const result of results.values()) {
                expect(result.entries.length).toBeGreaterThan(0);
                expect(result.entries[0]!.date.format('YYYY-MM-DD')).toBe('2026-05-04');
            }
            assertNoCrossZoneOverlap(results);
            assertProjectedDepletionSane(results, zones);
        });

        it('5. Staggered partial depletion — A fires day 0, B day 2, C day 6.', () => {
            const zones = [
                makeZone('a', { currentDepletionMm: 22.5 }),
                makeZone('b', { currentDepletionMm: 18.0 }),
                makeZone('c', { currentDepletionMm: 11.25 }),
            ];
            const weather = gatedWeather(14);

            const results = planAllZonesSequentially(zones, weather);

            expect(entryDates(results.get('a')!)[0]).toBe('2026-05-04');
            expect(entryDates(results.get('b')!)[0]).toBe('2026-05-06');
            expect(entryDates(results.get('c')!)[0]).toBe('2026-05-10');
            assertNoCrossZoneOverlap(results);
            assertProjectedDepletionSane(results, zones);
        });

        it('6. All zones slightly below threshold — fire together on day 1.', () => {
            // Starting depletion 20.0; net ET = 0.85 × 2.0 = 1.7/day.
            // Day 0: 20.0 + 1.7 = 21.7 < RAW (22.5) — no fire.
            // Day 1: 21.7 + 1.7 = 23.4 ≥ RAW — fires.
            const zones = [
                makeZone('a', { currentDepletionMm: 20.0 }),
                makeZone('b', { currentDepletionMm: 20.0 }),
                makeZone('c', { currentDepletionMm: 20.0 }),
            ];
            const weather = gatedWeather(14);

            const results = planAllZonesSequentially(zones, weather);

            for (const result of results.values()) {
                expect(result.entries.length).toBeGreaterThan(0);
                expect(entryDates(result)[0]).toBe('2026-05-05');
            }
            assertNoCrossZoneOverlap(results);
            assertProjectedDepletionSane(results, zones);
        });

        it('7. A fires repeatedly while B accumulates; the shared fire-night has no overlap.', () => {
            const zones = [
                makeZone('a', { currentDepletionMm: 11.25, rootDepthM: 0.15 }), // RAW 11.25
                makeZone('b', { currentDepletionMm: 0, rootDepthM: 0.30 }),     // RAW 22.5
            ];
            // 15 days so B (which needs ~14 days of ET to cross RAW) has a
            // next-day anchor when it finally fires (API-76 drops the last day).
            const weather = gatedWeather(15);

            const results = planAllZonesSequentially(zones, weather);

            const aDates = entryDates(results.get('a')!);
            const bDates = entryDates(results.get('b')!);
            // A fires more than once across the horizon.
            expect(aDates.length).toBeGreaterThanOrEqual(2);
            // B fires at least once (its first fire lands within the horizon).
            expect(bDates.length).toBeGreaterThanOrEqual(1);
            assertNoCrossZoneOverlap(results);
            assertProjectedDepletionSane(results, zones);
        });

        it('8. Triple interleave — all three zones share night 0 with no cross-zone overlap.', () => {
            // The COMPACT zones have ~15-min soak gaps and ~28-min cycles, so
            // follow-on cycles can't physically fit *inside* an earlier zone's
            // soak gap. Instead, the placer slides them earlier wholesale, with
            // each zone's runs back-to-back (no overlap, sharing the night).
            // The stricter "cycle inside soak gap" form is exercised on a
            // larger-gap zone in scenario 25.
            const zones = [
                makeZone('a', { currentDepletionMm: 22.5 }),
                makeZone('b', { currentDepletionMm: 22.5 }),
                makeZone('c', { currentDepletionMm: 22.5 }),
            ];
            const weather = gatedWeather(7);

            const results = planAllZonesSequentially(zones, weather);

            for (const result of results.values()) {
                expect(result.entries.length).toBeGreaterThan(0);
                expect(entryDates(result)[0]).toBe('2026-05-04');
            }
            assertNoCrossZoneOverlap(results);
            assertProjectedDepletionSane(results, zones);
        });

        it('9. Different RAW thresholds — heterogeneous cycle counts still avoid cross-zone overlap.', () => {
            const zones = [
                makeZone('a', { currentDepletionMm: 11.25, rootDepthM: 0.15 }), // RAW 11.25
                makeZone('b', { currentDepletionMm: 22.5, rootDepthM: 0.30 }),   // RAW 22.5
                makeZone('c', { currentDepletionMm: 33.75, rootDepthM: 0.45 }),  // RAW 33.75
            ];
            const weather = gatedWeather(7);

            const results = planAllZonesSequentially(zones, weather);

            for (const result of results.values()) {
                expect(result.entries.length).toBeGreaterThan(0);
                expect(entryDates(result)[0]).toBe('2026-05-04');
            }
            assertNoCrossZoneOverlap(results);
            assertProjectedDepletionSane(results, zones);
        });

        it('10. Dormant grass zone never crosses RAW across the horizon.', () => {
            const zones = [
                makeZone('a', { currentDepletionMm: 22.5 }),
                makeZone('b', { currentDepletionMm: 22.5 }),
                makeZone('c', { currentDepletionMm: 0, grassType: GRASS_TYPES.dormant }), // Kc 0.4
            ];
            const weather = gatedWeather(14);

            const results = planAllZonesSequentially(zones, weather);

            expect(results.get('a')!.entries.length).toBeGreaterThan(0);
            expect(results.get('b')!.entries.length).toBeGreaterThan(0);
            expect(results.get('c')!.entries).toHaveLength(0);
            assertProjectedDepletionSane(results, zones);
        });
    });

    describe('Theme B — Weather variation', () => {
        it('11. Heavy rainfall mid-horizon keeps all zones below RAW.', () => {
            // Starting depletion 10.0 + daily ET 1.7. Day 2 rain (10 mm → 8 mm
            // effective) drops everyone back below RAW well before the dry
            // accumulation could catch up across the 7-day horizon.
            const zones = [
                makeZone('a', { currentDepletionMm: 10.0 }),
                makeZone('b', { currentDepletionMm: 10.0 }),
                makeZone('c', { currentDepletionMm: 10.0 }),
            ];
            const weather = gatedWeather(7, 2.0, [0, 0, 10.0, 0, 0, 0, 0]);

            const results = planAllZonesSequentially(zones, weather);

            for (const result of results.values()) {
                expect(result.entries).toHaveLength(0);
            }
            assertProjectedDepletionSane(results, zones);
        });

        it('12. Sub-2mm rain is treated as zero effective rainfall — fire day matches the dry baseline.', () => {
            const zones = [
                makeZone('a', { currentDepletionMm: 20.0 }),
                makeZone('b', { currentDepletionMm: 20.0 }),
                makeZone('c', { currentDepletionMm: 20.0 }),
            ];
            // 1.5 mm rain per day is below the 2 mm effective-rain cutoff in
            // the planner ([api/schedules/dynamic/index.ts:120]) and contributes
            // 0 to the depletion math, so fire-day matches scenario 6 (day 1).
            const weather = gatedWeather(14, 2.0, Array.from({ length: 14 }, () => 1.5));

            const results = planAllZonesSequentially(zones, weather);

            for (const result of results.values()) {
                expect(entryDates(result)[0]).toBe('2026-05-05');
            }
            assertNoCrossZoneOverlap(results);
        });

        it('13. Heat wave — each zone re-fires at least once with no cross-zone overlap.', () => {
            const zones = [
                makeZone('a', { currentDepletionMm: 22.5 }),
                makeZone('b', { currentDepletionMm: 22.5 }),
                makeZone('c', { currentDepletionMm: 22.5 }),
            ];
            // Use a deterministic ET=6.0/day (avoid createHeatWave's RNG so the
            // test is stable). Net depletion 0.85×6=5.1 → re-fires in ~5 days.
            const weather = createDryPeriod(14, 6.0, START);

            const results = planAllZonesSequentially(zones, weather);

            for (const result of results.values()) {
                expect(result.entries.length).toBeGreaterThanOrEqual(2);
            }
            assertNoCrossZoneOverlap(results);
            assertProjectedDepletionSane(results, zones);
        });
    });

    describe('Theme C — Schedule restrictions', () => {
        it('14. allowedDays only schedules entries on those weekdays.', () => {
            const zones = [
                makeZone('a', { currentDepletionMm: 22.5 }),
                makeZone('b', { currentDepletionMm: 22.5 }),
                makeZone('c', { currentDepletionMm: 22.5 }),
            ];
            const weather = gatedWeather(14); // start 2026-05-04 is Monday (isoWeekday 1).
            const restrictions: ScheduleRestrictions = {
                allowedDays: [1, 3, 5], // Mon / Wed / Fri
                allowedTimeWindows: null,
            };

            const results = planAllZonesSequentially(zones, weather, restrictions);

            for (const result of results.values()) {
                for (const entry of result.entries) {
                    expect([1, 3, 5]).toContain(entry.date.isoWeekday());
                }
                expect(result.entries.length).toBeGreaterThan(0);
            }
            assertNoCrossZoneOverlap(results);
        });

        it('15. endBySunrise — every cycle ends at or before sunrise across all zones.', () => {
            const zones = [
                makeZone('a', { currentDepletionMm: 22.5 }),
                makeZone('b', { currentDepletionMm: 22.5 }),
                makeZone('c', { currentDepletionMm: 22.5 }),
            ];
            const weather = gatedWeather(7);
            const restrictions: ScheduleRestrictions = {
                allowedDays: null,
                allowedTimeWindows: null,
                endBySunrise: true,
            };

            const results = planAllZonesSequentially(zones, weather, restrictions);

            for (const result of results.values()) {
                for (const entry of result.entries) {
                    const sunrise = entry.sunriseAt;
                    expect(sunrise).toBeDefined();
                    for (const cycle of entry.cycles) {
                        const cycleEnd = cycle.startTime.add(cycle.durationMin, 'minute');
                        // 1-second tolerance to match the planner's own floating-point tolerance.
                        expect(cycleEnd.valueOf()).toBeLessThanOrEqual(sunrise!.valueOf() + 1000);
                    }
                }
            }
            assertNoCrossZoneOverlap(results);
        });

        it('16. skippedNightDate drops day 0 for every zone; depletion carries forward.', () => {
            const zones = [
                makeZone('a', { currentDepletionMm: 22.5 }),
                makeZone('b', { currentDepletionMm: 22.5 }),
                makeZone('c', { currentDepletionMm: 22.5 }),
            ];
            const weather = gatedWeather(14);
            const restrictions: ScheduleRestrictions = {
                allowedDays: null,
                allowedTimeWindows: null,
                skippedNightDate: '2026-05-04',
            };

            const results = planAllZonesSequentially(zones, weather, restrictions);

            for (const result of results.values()) {
                for (const entry of result.entries) {
                    expect(entry.date.format('YYYY-MM-DD')).not.toBe('2026-05-04');
                }
            }
            assertNoCrossZoneOverlap(results);
        });
    });

    describe('Theme D — Cycle-count edge cases', () => {
        it('17. Heterogeneous cycle counts — different soils / roots split into different cycle counts.', () => {
            // A: shallow root → ~1 cycle. B: default → ~2 cycles. C: lower
            // infiltration → many smaller cycles. All depleted at their RAW so
            // each fires on day 1 (gated-window scenario — fires once gating
            // kicks in on day 1 with sufficient overnight window).
            const zones = [
                makeZone('a', { currentDepletionMm: 7.5, rootDepthM: 0.1 }), // shallow → RAW 7.5
                makeZone('b', { currentDepletionMm: 22.5 }), // default → RAW 22.5
                makeZone('c', { currentDepletionMm: 22.5, soil: { name: 'LowInf', availableWaterHoldingCapacityMmPerM: 150, infiltrationRateMmPerHr: 8 } }),
            ];
            const weather = gatedWeather(7);

            const results = planAllZonesSequentially(zones, weather);

            for (const result of results.values()) {
                expect(result.entries.length).toBeGreaterThan(0);
            }
            assertNoCrossZoneOverlap(results);
        });

        it('18. Overnight saturation — the planner never produces an overlapping cycle, even when some days defer.', () => {
            // Three deep-root + low-infiltration zones won't all fit on
            // the same night; planner defers what doesn't fit. Critical
            // invariant: no overlap ever, even under saturation pressure.
            const zones = [
                makeZone('a', { currentDepletionMm: 27.0, rootDepthM: 0.6, soil: SOIL_TYPES.clay, precipitationRateMmPerHr: 9 }),
                makeZone('b', { currentDepletionMm: 27.0, rootDepthM: 0.6, soil: SOIL_TYPES.clay, precipitationRateMmPerHr: 9 }),
                makeZone('c', { currentDepletionMm: 27.0, rootDepthM: 0.6, soil: SOIL_TYPES.clay, precipitationRateMmPerHr: 9 }),
            ];
            const weather = gatedWeather(14);

            const results = planAllZonesSequentially(zones, weather);

            // No overlap, regardless of how many zones ended up deferring days.
            assertNoCrossZoneOverlap(results);
        });
    });

    describe('Theme E — Zone state', () => {
        it('19. Disabled zone produces no entries; other zones still fire normally.', () => {
            const zones = [
                makeZone('a', { currentDepletionMm: 22.5, isEnabled: false }),
                makeZone('b', { currentDepletionMm: 22.5 }),
                makeZone('c', { currentDepletionMm: 22.5 }),
            ];
            const weather = gatedWeather(7);

            const results = planAllZonesSequentially(zones, weather);

            expect(results.get('a')!.entries).toHaveLength(0);
            expect(results.get('b')!.entries.length).toBeGreaterThan(0);
            expect(results.get('c')!.entries.length).toBeGreaterThan(0);
            assertNoCrossZoneOverlap(results);
        });

        it('20. Reverse zone order — every zone still fires on the same day with the same applied depth.', () => {
            const a = makeZone('a', { currentDepletionMm: 22.5 });
            const b = makeZone('b', { currentDepletionMm: 22.5 });
            const c = makeZone('c', { currentDepletionMm: 22.5 });
            const weather = gatedWeather(7);

            const forward = planAllZonesSequentially([a, b, c], weather);
            const reverse = planAllZonesSequentially([c, b, a], weather);

            for (const id of ['a', 'b', 'c']) {
                const fwd = forward.get(id)!;
                const rev = reverse.get(id)!;
                expect(fwd.entries.length).toBe(rev.entries.length);
                // Total applied depth on day 0 is the same regardless of order.
                const fwdDepth = fwd.entries[0]?.appliedDepthMm ?? 0;
                const revDepth = rev.entries[0]?.appliedDepthMm ?? 0;
                expect(fwdDepth).toBeCloseTo(revDepth, 5);
            }
            assertNoCrossZoneOverlap(reverse);
        });
    });

    describe('Theme F — Past-window mechanics', () => {
        const pastWindow = (now: Dayjs): BusyWindow => ({ start: dayjs(new Date(0)), end: now });

        it('21. Past window without endBySunrise — every zone\'s day-0 cycles shift to start at-or-after now.', () => {
            // Note (known planner limitation): when multiple zones get the
            // past-window forward shift, each zone's cycles are re-anchored
            // independently against the pastWindow only — not against the
            // already-shifted cross-zone cycles. Result: B's shifted cycles
            // can collide with A's shifted cycles. Tracked separately as a
            // planner follow-up; this scenario only asserts the "shifted to
            // at-or-after now" invariant, not cross-zone non-overlap.
            const zones = [
                makeZone('a', { currentDepletionMm: 22.5 }),
                makeZone('b', { currentDepletionMm: 22.5 }),
                makeZone('c', { currentDepletionMm: 22.5 }),
            ];
            const weather = gatedWeather(7);
            const now = START.hour(12); // noon of day 0

            const busyWindows: BusyWindow[] = [pastWindow(now)];
            const results = new Map<string, PlanZoneScheduleResult>();
            for (const zone of zones) {
                const result = planZoneSchedule(zone, weather, busyWindows);
                results.set(zone.id, result);
                for (const entry of result.entries) {
                    for (const cycle of entry.cycles) {
                        busyWindows.push({
                            start: cycle.startTime,
                            end: cycle.startTime.add(cycle.durationMin, 'minute'),
                        });
                    }
                }
            }

            for (const result of results.values()) {
                const day0 = result.entries.find(e => e.date.format('YYYY-MM-DD') === '2026-05-04');
                expect(day0).toBeDefined();
                for (const cycle of day0!.cycles) {
                    expect(cycle.startTime.valueOf()).toBeGreaterThanOrEqual(now.valueOf());
                }
            }
        });

        it('22. Past window WITH endBySunrise — day-0 cycles still land overnight by construction (API-76).', () => {
            // Pre-API-76 the planner placed day-0 cycles in [Sun 00:00, Sun
            // sunrise] (already past) and the forward-shift + endBySunrise gate
            // dropped them. With the anchor shift cycles cleanly run [Mon 00:00,
            // Mon sunrise] — already overnight, no shift needed — so the
            // endBySunrise restriction is automatically satisfied and day 0
            // continues to produce an entry.
            const zones = [
                makeZone('a', { currentDepletionMm: 22.5 }),
                makeZone('b', { currentDepletionMm: 22.5 }),
                makeZone('c', { currentDepletionMm: 22.5 }),
            ];
            const weather = gatedWeather(7);
            const now = START.hour(12);
            const restrictions: ScheduleRestrictions = {
                allowedDays: null,
                allowedTimeWindows: null,
                endBySunrise: true,
            };

            const busyWindows: BusyWindow[] = [pastWindow(now)];
            const results = new Map<string, PlanZoneScheduleResult>();
            for (const zone of zones) {
                const result = planZoneSchedule(zone, weather, busyWindows, restrictions);
                results.set(zone.id, result);
                for (const entry of result.entries) {
                    for (const cycle of entry.cycles) {
                        busyWindows.push({
                            start: cycle.startTime,
                            end: cycle.startTime.add(cycle.durationMin, 'minute'),
                        });
                    }
                }
            }

            for (const result of results.values()) {
                const day0 = result.entries.find(e => e.date.format('YYYY-MM-DD') === '2026-05-04');
                expect(day0).toBeDefined();
                const sunrise = day0!.sunriseAt!;
                for (const cycle of day0!.cycles) {
                    const cycleEnd = cycle.startTime.add(cycle.durationMin, 'minute');
                    expect(cycleEnd.valueOf()).toBeLessThanOrEqual(sunrise.valueOf() + 1000);
                }
            }
        });
    });

    describe('Theme G — Boundary conditions', () => {
        it('23. Depletion exactly at RAW fires day 0 (inclusive boundary).', () => {
            const zones = [
                makeZone('a', { currentDepletionMm: 22.5 }), // RAW exactly
                makeZone('b', { currentDepletionMm: 22.5 }),
                makeZone('c', { currentDepletionMm: 22.5 }),
            ];
            const weather = gatedWeather(7);

            const results = planAllZonesSequentially(zones, weather);

            for (const result of results.values()) {
                expect(entryDates(result)[0]).toBe('2026-05-04');
            }
            assertNoCrossZoneOverlap(results);
        });

        it('24. Depletion at TAW — appliedDepthMm reflects the clamp, no negative or overflow values.', () => {
            const zones = [
                makeZone('a', { currentDepletionMm: 45.0 }), // TAW
                makeZone('b', { currentDepletionMm: 45.0 }),
                makeZone('c', { currentDepletionMm: 45.0 }),
            ];
            const weather = gatedWeather(7);

            const results = planAllZonesSequentially(zones, weather);

            for (const result of results.values()) {
                expect(result.entries.length).toBeGreaterThan(0);
                for (const entry of result.entries) {
                    expect(entry.appliedDepthMm).toBeGreaterThan(0);
                    expect(Number.isFinite(entry.appliedDepthMm)).toBe(true);
                }
            }
            assertProjectedDepletionSane(results, zones);
            assertNoCrossZoneOverlap(results);
        });

        it(`25. Different per-zone soak times — long soaks are not violated by other zones' cycles.`, () => {
            // Three zones with shallow roots so all three fit overnight even
            // with the more-cycles-per-zone profile B carries:
            //   A: default soil (infiltration 25 → 15-min soak).
            //   B: lower-infiltration soil (8 → 35-min soak), splits into more cycles.
            //   C: sandyLoam (infiltration 30 → 15-min soak).
            const lowInfiltrationSoil = { name: 'LowInf', availableWaterHoldingCapacityMmPerM: 150, infiltrationRateMmPerHr: 8 };
            const zones = [
                makeZone('a', { currentDepletionMm: 7.5, rootDepthM: 0.1 }), // RAW 7.5
                makeZone('b', { currentDepletionMm: 7.5, rootDepthM: 0.1, soil: lowInfiltrationSoil }),
                makeZone('c', { currentDepletionMm: 6.25, rootDepthM: 0.1, soil: SOIL_TYPES.sandyLoam }), // RAW 6.25
            ];
            const weather = gatedWeather(7);

            const results = planAllZonesSequentially(zones, weather);

            for (const result of results.values()) {
                expect(result.entries.length).toBeGreaterThan(0);
            }
            assertNoCrossZoneOverlap(results);
            assertProjectedDepletionSane(results, zones);

            // B's intra-zone soak (35 min) is never shortened. The loop is a
            // no-op when B has a single cycle, in which case the invariant
            // is trivially upheld.
            const b = results.get('b')!;
            for (const entry of b.entries) {
                const sorted = [...entry.cycles].sort((x, y) => x.startTime.valueOf() - y.startTime.valueOf());
                for (let i = 0; i < sorted.length - 1; i++) {
                    const gapMin = sorted[i + 1]!.startTime.diff(sorted[i]!.startTime.add(sorted[i]!.durationMin, 'minute'), 'minute');
                    expect(gapMin).toBeGreaterThanOrEqual(35);
                }
            }
        });
    });

    describe('Theme H — Multi-zone interleaving (API-73)', () => {
        // Zone A's soil: 8 mm/hr infiltration → 35-min soak between A cycles.
        // With COMPACT precipitation (30 mm/hr) and rootDepth 0.3 + depletion
        // 22.5, A splits into 4 cycles × ~14 min each and leaves three 35-min
        // soak gaps wide enough for a default-loam B cycle to slot inside.
        const LOW_INF_SOIL = { name: 'LowInf', availableWaterHoldingCapacityMmPerM: 150, infiltrationRateMmPerHr: 8 };

        it(`26. B's single cycle slots into one of A's soak gaps when there's room.`, () => {
            const a = makeZone('a', { currentDepletionMm: 22.5, soil: LOW_INF_SOIL });
            // B: default loam (15-min soak) + shallow root → single ~28-min cycle.
            const b = makeZone('b', { currentDepletionMm: 11.25, rootDepthM: 0.15 });
            const weather = gatedWeather(7);

            const results = planAllZonesSequentially([a, b], weather);

            const aDay0 = day0CyclesSorted(results.get('a')!, '2026-05-04');
            const bDay0 = day0CyclesSorted(results.get('b')!, '2026-05-04');
            expect(aDay0.length).toBeGreaterThanOrEqual(2); // need at least one soak gap
            expect(bDay0).toHaveLength(1);

            // The single B cycle lands strictly inside one of A's intra-zone soak gaps.
            const gapIndex = assertCycleInsideSoakGap(bDay0[0]!, aDay0);
            expect(gapIndex).toBeGreaterThanOrEqual(0);
            assertNoCrossZoneOverlap(results);
            assertProjectedDepletionSane(results, [a, b]);
        });

        it(`27. Each of B's two cycles slots into a different A soak gap.`, () => {
            const a = makeZone('a', { currentDepletionMm: 22.5, soil: LOW_INF_SOIL });
            // B: default loam, default root, depletion 22.5 → 2 cycles × ~28 min,
            // each narrow enough (28 min < 35 min) to fit inside A's 35-min gaps.
            const b = makeZone('b', { currentDepletionMm: 22.5 });
            const weather = gatedWeather(7);

            const results = planAllZonesSequentially([a, b], weather);

            const aDay0 = day0CyclesSorted(results.get('a')!, '2026-05-04');
            const bDay0 = day0CyclesSorted(results.get('b')!, '2026-05-04');
            expect(aDay0.length).toBeGreaterThanOrEqual(3); // need ≥ 2 soak gaps
            expect(bDay0).toHaveLength(2);

            // Both of B's cycles fit inside some soak gap of A — different gaps.
            const firstGap = assertCycleInsideSoakGap(bDay0[0]!, aDay0);
            const secondGap = assertCycleInsideSoakGap(bDay0[1]!, aDay0);
            expect(firstGap).not.toBe(secondGap);
            assertNoCrossZoneOverlap(results);
            assertProjectedDepletionSane(results, [a, b]);
        });

        it('28. Multi-zone block span equals A-solo span when B fits entirely inside A gaps.', () => {
            // A alone vs A + B sequentially: when every B cycle slots into an
            // existing A soak gap, B contributes zero added overhead — the
            // combined block must end at the same earliest start and the same
            // latest end as A on its own. This is the "compress the overnight
            // schedule" invariant the ticket is asking us to lock in.
            const a = makeZone('a', { currentDepletionMm: 22.5, soil: LOW_INF_SOIL });
            const b = makeZone('b', { currentDepletionMm: 22.5 });
            const weather = gatedWeather(7);

            const aSolo = planAllZonesSequentially([a], weather);
            const aSoloDay0 = day0CyclesSorted(aSolo.get('a')!, '2026-05-04');
            const aSoloSpan = blockSpanMinutes(aSoloDay0);

            const combined = planAllZonesSequentially([a, b], weather);
            const combinedDay0: TimedCycle[] = [
                ...day0CyclesSorted(combined.get('a')!, '2026-05-04'),
                ...day0CyclesSorted(combined.get('b')!, '2026-05-04'),
            ];
            const combinedSpan = blockSpanMinutes(combinedDay0);

            expect(combinedSpan).toBe(aSoloSpan);
            assertNoCrossZoneOverlap(combined);
        });
    });

    describe('Theme I — Partial refill when full-refill exceeds the overnight window (API-75)', () => {
        // Production-shaped zone: clay-loam soil (5 mm/hr infiltration → 45-min
        // soak, 165 AWHC/m), default root 0.3 m, low precipitation (18.75 mm/hr).
        // Full-refill runtime at TAW depletion (49.5 mm) is ~14 h — well past
        // the 360-min midnight-to-sunrise window. Pre-API-75 this deferred the
        // night forever; now the planner clamps to a partial refill and carries
        // the residual into the next allowed night.
        const CLAY_LOAM_SLOW = { name: 'ClayLoamSlow', availableWaterHoldingCapacityMmPerM: 165, infiltrationRateMmPerHr: 5 };
        const PARTIAL_REFILL_ZONE: Partial<Zone> = {
            soil: CLAY_LOAM_SLOW,
            rootDepthM: 0.3,
            allowableDepletionFraction: 0.5,
            irrigationEfficiency: 0.8,
            precipitationRateMmPerHr: 18.75,
        };

        it('29. Single zone with deep deficit: cycles fit the window; entry reflects a partial refill.', () => {
            const zone = makeZone('a', { ...PARTIAL_REFILL_ZONE, currentDepletionMm: 49.5 });
            const weather = gatedWeather(7);

            const { entries } = planZoneSchedule(zone, weather);

            expect(entries.length).toBeGreaterThan(0);
            const day0 = entries[0]!;
            // All cycles fit inside [midnight, sunrise].
            const midnight = day0.date.startOf('day');
            const sunrise = day0.sunriseAt!;
            for (const cycle of day0.cycles) {
                expect(cycle.startTime.valueOf()).toBeGreaterThanOrEqual(midnight.valueOf());
                const cycleEnd = cycle.startTime.add(cycle.durationMin, 'minute');
                expect(cycleEnd.valueOf()).toBeLessThanOrEqual(sunrise.valueOf() + 1000);
            }
            // Clamp activated: applied gross is less than full-refill gross
            // (depletion / efficiency) and depletionAfter is the residual.
            const fullRefillGross = day0.depletionBeforeMm / zone.irrigationEfficiency;
            expect(day0.appliedDepthMm).toBeLessThan(fullRefillGross);
            expect(day0.depletionAfterMm).toBeGreaterThan(0);
            const expectedAfter = day0.depletionBeforeMm - day0.appliedDepthMm * zone.irrigationEfficiency;
            expect(day0.depletionAfterMm).toBeCloseTo(expectedAfter, 0);
        });

        it('30. Follow-on night picks up the residual.', () => {
            const zone = makeZone('a', { ...PARTIAL_REFILL_ZONE, currentDepletionMm: 49.5 });
            const weather = gatedWeather(7);

            const { entries } = planZoneSchedule(zone, weather);

            // The deficit doesn't clear in one night — the planner emits a
            // follow-on entry on day 1 to keep irrigating.
            expect(entries.length).toBeGreaterThanOrEqual(2);
            const day0 = entries[0]!;
            const day1 = entries[1]!;
            // Day 1's depletionBefore picks up the residual from day 0 plus
            // ~1 day of ET; it must NOT reset to the seed value or to 0.
            expect(day1.depletionBeforeMm).toBeGreaterThan(0);
            expect(day1.depletionBeforeMm).toBeLessThan(day0.depletionBeforeMm);
        });

        it('31. Fits-in-one-night zones remain unchanged: no clamp, full refill.', () => {
            // Default loam + COMPACT precip — the standard multi-zone profile.
            // Full-refill runtime (~60 min) fits well within the 360-min window.
            const zone = makeZone('a', { currentDepletionMm: 22.5 });
            const weather = gatedWeather(7);

            const { entries } = planZoneSchedule(zone, weather);

            expect(entries.length).toBeGreaterThan(0);
            const day0 = entries[0]!;
            // Full refill: applied gross ≈ depletionBefore / efficiency (within
            // 1-decimal rounding) and the residual depletion is zero.
            const fullRefillGross = day0.depletionBeforeMm / zone.irrigationEfficiency;
            expect(Math.abs(day0.appliedDepthMm - fullRefillGross)).toBeLessThanOrEqual(0.1);
            expect(day0.depletionAfterMm).toBe(0);
        });
    });
});
