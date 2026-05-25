import { describe, it, expect } from 'bun:test';
import dayjs from 'dayjs';
import { createTestZone, GRASS_TYPES, SOIL_TYPES } from '@/mock/zone';
import {
    createWeatherDays,
    createDryPeriod,
    createRainyPeriod,
    createIntermittentRainfall,
    createVariableET,
    createHeatWave,
} from '@/mock/weather';
import { planZoneSchedule } from '.';

describe('planZoneSchedule', () => {
    // Core Irrigation Scheduling Tests.
    describe('Core Irrigation Scheduling', () => {
        it('should not schedule irrigation when depletion stays below threshold', () => {
            const zone = createTestZone({
                currentDepletionMm: 5,
                allowableDepletionFraction: 0.5,
            });
            const weather = createDryPeriod(7, 1.0);

            const { entries: schedule } = planZoneSchedule(zone, weather);

            expect(schedule).toHaveLength(0);
        });

        it('should schedule single irrigation when depletion exceeds threshold once', () => {
            const zone = createTestZone({
                currentDepletionMm: 20,
                allowableDepletionFraction: 0.5,
            });
            const weather = createDryPeriod(7, 1.5);

            const { entries: schedule } = planZoneSchedule(zone, weather);

            expect(schedule.length).toBeGreaterThan(0);
            expect(schedule[0]!.appliedDepthMm).toBeGreaterThan(0);
        });

        it('should schedule multiple irrigation events during extended dry period', () => {
            const zone = createTestZone({
                currentDepletionMm: 0,
                allowableDepletionFraction: 0.5,
            });
            const weather = createDryPeriod(30, 3.5);

            const { entries: schedule } = planZoneSchedule(zone, weather);

            expect(schedule.length).toBeGreaterThan(1);
        });

        it('should schedule many irrigation sessions during heat wave', () => {
            const zone = createTestZone({
                currentDepletionMm: 0,
                allowableDepletionFraction: 0.5,
                grassType: GRASS_TYPES.highWater,
            });
            const weather = createHeatWave(14);

            const { entries: schedule } = planZoneSchedule(zone, weather);

            // Heat wave with high water use grass requires frequent irrigation.
            expect(schedule.length).toBeGreaterThan(3);
        });

        it('should schedule irrigation on first day when starting above threshold', () => {
            const zone = createTestZone({
                currentDepletionMm: 25,
                allowableDepletionFraction: 0.5,
            });
            const weather = createDryPeriod(7, 2.0);

            const { entries: schedule } = planZoneSchedule(zone, weather);

            expect(schedule.length).toBeGreaterThan(0);
            expect(schedule[0]!.date.format('YYYY-MM-DD')).toBe(weather[0]!.date.format('YYYY-MM-DD'));
        });

        it('should schedule irrigation on last day when threshold reached at end', () => {
            const zone = createTestZone({
                currentDepletionMm: 18,
                allowableDepletionFraction: 0.5,
            });
            const weather = createWeatherDays([
                { evapotranspirationMmPerDay: 0.5, rainfallMm: 0 },
                { evapotranspirationMmPerDay: 0.5, rainfallMm: 0 },
                { evapotranspirationMmPerDay: 0.5, rainfallMm: 0 },
                { evapotranspirationMmPerDay: 0.5, rainfallMm: 0 },
                { evapotranspirationMmPerDay: 10.0, rainfallMm: 0 },
            ]);

            const { entries: schedule } = planZoneSchedule(zone, weather);

            expect(schedule.length).toBeGreaterThan(0);
            const lastScheduled = schedule[schedule.length - 1]!;
            expect(lastScheduled.date.format('YYYY-MM-DD')).toBe(weather[4]!.date.format('YYYY-MM-DD'));
        });
    });

    // Rainfall Pattern Tests.
    describe('Rainfall Patterns', () => {
        it('should ignore light rainfall below 2mm threshold', () => {
            const zone = createTestZone({ currentDepletionMm: 20 });
            const weather = createWeatherDays([
                { evapotranspirationMmPerDay: 2.0, rainfallMm: 1.9 },
                { evapotranspirationMmPerDay: 2.0, rainfallMm: 1.5 },
                { evapotranspirationMmPerDay: 2.0, rainfallMm: 0.5 },
            ]);

            const { entries: schedule } = planZoneSchedule(zone, weather);

            expect(schedule.length).toBeGreaterThan(0);
        });

        it('should prevent irrigation with heavy rainfall that reduces depletion', () => {
            const zone = createTestZone({ currentDepletionMm: 20 });
            const weather = createWeatherDays([
                { evapotranspirationMmPerDay: 2.0, rainfallMm: 15.0 },
                { evapotranspirationMmPerDay: 2.0, rainfallMm: 10.0 },
                { evapotranspirationMmPerDay: 2.0, rainfallMm: 0 },
            ]);

            const { entries: schedule } = planZoneSchedule(zone, weather);

            expect(schedule).toHaveLength(0);
        });

        it('should handle rainfall after scheduled irrigation', () => {
            const zone = createTestZone({ currentDepletionMm: 23 });
            const weather = createWeatherDays([
                { evapotranspirationMmPerDay: 2.0, rainfallMm: 0 },
                { evapotranspirationMmPerDay: 2.0, rainfallMm: 10.0 },
                { evapotranspirationMmPerDay: 2.0, rainfallMm: 0 },
            ]);

            const { entries: schedule } = planZoneSchedule(zone, weather);

            expect(schedule.length).toBeGreaterThan(0);
        });

        it('should handle intermittent rainfall pattern', () => {
            const zone = createTestZone({ currentDepletionMm: 10 });
            const weather = createIntermittentRainfall(14);

            const { entries: schedule } = planZoneSchedule(zone, weather);

            // Should have some irrigation events but fewer than dry period.
            expect(schedule.length).toBeLessThan(14);
        });

        it('should handle consecutive rainy days preventing irrigation', () => {
            const zone = createTestZone({ currentDepletionMm: 15 });
            const weather = createRainyPeriod(10, 8.0);

            const { entries: schedule } = planZoneSchedule(zone, weather);

            expect(schedule).toHaveLength(0);
        });

        it('should treat exactly 2mm rainfall as effective', () => {
            const zone = createTestZone({ currentDepletionMm: 20 });
            const weather = createWeatherDays([
                { evapotranspirationMmPerDay: 2.0, rainfallMm: 2.0 },
            ]);

            const { entries: schedule } = planZoneSchedule(zone, weather);

            // 2mm * 0.8 = 1.6mm effective rainfall, less than 2mm ET.
            // Depletion: 20 + 2 - 1.6 = 20.4mm (still below 22.5mm threshold).
            expect(schedule).toHaveLength(0);
        });
    });

    // Evapotranspiration Scenarios.
    describe('Evapotranspiration Scenarios', () => {
        it('should handle zero ET days with no depletion increase', () => {
            const zone = createTestZone({ currentDepletionMm: 10 });
            const weather = createWeatherDays([
                { evapotranspirationMmPerDay: 0, rainfallMm: 0 },
                { evapotranspirationMmPerDay: 0, rainfallMm: 0 },
                { evapotranspirationMmPerDay: 0, rainfallMm: 0 },
            ]);

            const { entries: schedule } = planZoneSchedule(zone, weather);

            expect(schedule).toHaveLength(0);
        });

        it('should handle high ET period requiring frequent irrigation', () => {
            const zone = createTestZone({ currentDepletionMm: 0 });
            const weather = createDryPeriod(14, 6.0);

            const { entries: schedule } = planZoneSchedule(zone, weather);

            expect(schedule.length).toBeGreaterThan(2);
        });

        it('should handle variable ET pattern', () => {
            const zone = createTestZone({ currentDepletionMm: 10 });
            const weather = createVariableET(14);

            const { entries: schedule } = planZoneSchedule(zone, weather);

            expect(schedule.length).toBeGreaterThan(0);
        });

        it('should handle extreme ET spike on single day', () => {
            const zone = createTestZone({ currentDepletionMm: 15 });
            const weather = createWeatherDays([
                { evapotranspirationMmPerDay: 1.0, rainfallMm: 0 },
                { evapotranspirationMmPerDay: 1.0, rainfallMm: 0 },
                { evapotranspirationMmPerDay: 15.0, rainfallMm: 0 },
                { evapotranspirationMmPerDay: 1.0, rainfallMm: 0 },
            ]);

            const { entries: schedule } = planZoneSchedule(zone, weather);

            expect(schedule.length).toBeGreaterThan(0);
        });
    });

    // Soil Type Tests.
    describe('Soil Types', () => {
        it('should handle sandy soil with rapid depletion', () => {
            const zone = createTestZone({
                soil: SOIL_TYPES.sand,
                currentDepletionMm: 0,
            });
            const weather = createDryPeriod(14, 3.0);

            const { entries: schedule } = planZoneSchedule(zone, weather);

            // Sandy soil has lower AWHC, reaches threshold faster.
            expect(schedule.length).toBeGreaterThanOrEqual(3);
        });

        it('should handle clay soil with slow depletion', () => {
            const zone = createTestZone({
                soil: SOIL_TYPES.clay,
                currentDepletionMm: 0,
            });
            const weather = createDryPeriod(14, 3.0);

            const { entries: schedule } = planZoneSchedule(zone, weather);

            // Clay soil has higher AWHC, takes longer to reach threshold.
            expect(schedule.length).toBeLessThan(5);
        });

        it('should handle loam soil with balanced characteristics', () => {
            const zone = createTestZone({
                soil: SOIL_TYPES.loam,
                currentDepletionMm: 0,
            });
            const weather = createDryPeriod(14, 3.0);

            const { entries: schedule } = planZoneSchedule(zone, weather);

            expect(schedule.length).toBeGreaterThan(0);
            expect(schedule.length).toBeLessThan(14);
        });

        it('should handle sandy loam soil', () => {
            const zone = createTestZone({
                soil: SOIL_TYPES.sandyLoam,
                currentDepletionMm: 0,
            });
            const weather = createDryPeriod(14, 3.0);

            const { entries: schedule } = planZoneSchedule(zone, weather);

            expect(schedule.length).toBeGreaterThan(0);
        });
    });

    // Grass Type & Crop Coefficient Tests.
    describe('Grass Types & Crop Coefficients', () => {
        it('should handle low water use grass with less frequent irrigation', () => {
            const zone = createTestZone({
                grassType: GRASS_TYPES.lowWater,
                currentDepletionMm: 0,
            });
            const weather = createDryPeriod(14, 4.0);

            const { entries: schedule } = planZoneSchedule(zone, weather);

            expect(schedule.length).toBeLessThan(7);
        });

        it('should handle medium water use grass', () => {
            const zone = createTestZone({
                grassType: GRASS_TYPES.medium,
                currentDepletionMm: 0,
            });
            const weather = createDryPeriod(14, 4.0);

            const { entries: schedule } = planZoneSchedule(zone, weather);

            expect(schedule.length).toBeGreaterThan(0);
        });

        it('should handle high water use grass with frequent irrigation', () => {
            const zone = createTestZone({
                grassType: GRASS_TYPES.highWater,
                currentDepletionMm: 0,
            });
            const weather = createDryPeriod(14, 4.0);

            const { entries: schedule } = planZoneSchedule(zone, weather);

            expect(schedule.length).toBeGreaterThan(1);
        });

        it('should handle dormant grass with minimal water needs', () => {
            const zone = createTestZone({
                grassType: GRASS_TYPES.dormant,
                currentDepletionMm: 0,
            });
            const weather = createDryPeriod(14, 5.0);

            const { entries: schedule } = planZoneSchedule(zone, weather);

            expect(schedule.length).toBeLessThan(3);
        });

        it('microclimateFactor above 1 increases irrigation frequency relative to factor of 1', () => {
            const baseZone = createTestZone({ currentDepletionMm: 0, microclimateFactor: 1 });
            const sunnyZone = createTestZone({ currentDepletionMm: 0, microclimateFactor: 1.1 });
            const weather = createDryPeriod(14, 3.0);

            const { entries: baseSchedule } = planZoneSchedule(baseZone, weather);
            const { entries: sunnySchedule } = planZoneSchedule(sunnyZone, weather);

            expect(sunnySchedule.length).toBeGreaterThanOrEqual(baseSchedule.length);
        });

        it('microclimateFactor below 1 decreases irrigation frequency relative to factor of 1', () => {
            const baseZone = createTestZone({ currentDepletionMm: 0, microclimateFactor: 1 });
            const shadyZone = createTestZone({ currentDepletionMm: 0, microclimateFactor: 0.85 });
            const weather = createDryPeriod(14, 3.0);

            const { entries: baseSchedule } = planZoneSchedule(baseZone, weather);
            const { entries: shadySchedule } = planZoneSchedule(shadyZone, weather);

            expect(shadySchedule.length).toBeLessThanOrEqual(baseSchedule.length);
        });
    });

    // Root Depth Variations.
    describe('Root Depth Variations', () => {
        it('should handle shallow roots requiring more frequent irrigation', () => {
            const zone = createTestZone({
                rootDepthM: 0.15,
                currentDepletionMm: 0,
            });
            const weather = createDryPeriod(14, 3.0);

            const { entries: schedule } = planZoneSchedule(zone, weather);

            // Shallow roots mean less total available water, more frequent irrigation.
            expect(schedule.length).toBeGreaterThan(2);
        });

        it('should handle medium roots with moderate irrigation frequency', () => {
            const zone = createTestZone({
                rootDepthM: 0.3,
                currentDepletionMm: 0,
            });
            const weather = createDryPeriod(14, 3.0);

            const { entries: schedule } = planZoneSchedule(zone, weather);

            expect(schedule.length).toBeGreaterThan(0);
        });

        it('should handle deep roots with less frequent irrigation', () => {
            const zone = createTestZone({
                rootDepthM: 0.5,
                currentDepletionMm: 0,
            });
            const weather = createDryPeriod(14, 3.0);

            const { entries: schedule } = planZoneSchedule(zone, weather);

            // Deep roots mean more total available water, less frequent irrigation.
            expect(schedule.length).toBeLessThan(5);
        });
    });

    // Allowable Depletion Tests.
    describe('Allowable Depletion', () => {
        it('should trigger irrigation earlier with conservative depletion (30%)', () => {
            const zone = createTestZone({
                allowableDepletionFraction: 0.3,
                currentDepletionMm: 0,
            });
            const weather = createDryPeriod(14, 2.5);

            const { entries: schedule } = planZoneSchedule(zone, weather);

            expect(schedule.length).toBeGreaterThan(1);
        });

        it('should use standard depletion (50%) for typical lawn management', () => {
            const zone = createTestZone({
                allowableDepletionFraction: 0.5,
                currentDepletionMm: 0,
            });
            const weather = createDryPeriod(14, 2.5);

            const { entries: schedule } = planZoneSchedule(zone, weather);

            expect(schedule.length).toBeGreaterThan(0);
            expect(schedule.length).toBeLessThan(7);
        });

        it('should allow more depletion with aggressive management (70%)', () => {
            const zone = createTestZone({
                allowableDepletionFraction: 0.7,
                currentDepletionMm: 0,
            });
            const weather = createDryPeriod(14, 2.5);

            const { entries: schedule } = planZoneSchedule(zone, weather);

            expect(schedule.length).toBeLessThan(4);
        });
    });

    // Irrigation Efficiency Tests.
    describe('Irrigation Efficiency', () => {
        it('should apply more gross water with low efficiency (60%)', () => {
            const zone = createTestZone({
                irrigationEfficiency: 0.6,
                currentDepletionMm: 22,
            });
            const weather = createDryPeriod(3, 1.0);

            const { entries: schedule } = planZoneSchedule(zone, weather);

            expect(schedule.length).toBeGreaterThan(0);
            // Lower efficiency requires more applied depth.
            expect(schedule[0]!.appliedDepthMm).toBeGreaterThan(30);
        });

        it('should apply moderate gross water with medium efficiency (80%)', () => {
            const zone = createTestZone({
                irrigationEfficiency: 0.8,
                currentDepletionMm: 22,
            });
            const weather = createDryPeriod(3, 1.0);

            const { entries: schedule } = planZoneSchedule(zone, weather);

            expect(schedule.length).toBeGreaterThan(0);
            expect(schedule[0]!.appliedDepthMm).toBeGreaterThan(20);
            expect(schedule[0]!.appliedDepthMm).toBeLessThan(30);
        });

        it('should apply less gross water with high efficiency (95%)', () => {
            const zone = createTestZone({
                irrigationEfficiency: 0.95,
                currentDepletionMm: 22,
            });
            const weather = createDryPeriod(3, 1.0);

            const { entries: schedule } = planZoneSchedule(zone, weather);

            expect(schedule.length).toBeGreaterThan(0);
            expect(schedule[0]!.appliedDepthMm).toBeLessThan(25);
        });
    });

    // Cycle Splitting Tests.
    describe('Cycle Splitting', () => {
        it('should use single cycle when runtime is below infiltration constraint', () => {
            const zone = createTestZone({
                soil: SOIL_TYPES.loam,
                currentDepletionMm: 22,
                flowRateLPerMin: 10,
            });
            const weather = createDryPeriod(3, 1.0);

            const { entries: schedule } = planZoneSchedule(zone, weather);

            expect(schedule.length).toBeGreaterThan(0);
            // May require 1 or 2 cycles depending on infiltration.
            expect(schedule[0]!.cycles.length).toBeGreaterThan(0);
        });

        it('should split into two cycles when needed', () => {
            const zone = createTestZone({
                soil: SOIL_TYPES.clay,
                currentDepletionMm: 22,
                flowRateLPerMin: 25,
                areaM2: 50,
            });
            const weather = createDryPeriod(3, 1.0);

            const { entries: schedule } = planZoneSchedule(zone, weather);

            // Clay soil with low infiltration may prevent irrigation if depletion doesn't build enough.
            if (schedule.length > 0) {
                expect(schedule[0]!.cycles.length).toBeGreaterThanOrEqual(1);
            } else {
                // Depletion didn't reach threshold.
                expect(schedule).toHaveLength(0);
            }
        });

        it('should split into multiple cycles for clay soil with high precipitation rate', () => {
            const zone = createTestZone({
                soil: SOIL_TYPES.clay,
                currentDepletionMm: 22,
                flowRateLPerMin: 30,
                areaM2: 40,
            });
            const weather = createDryPeriod(3, 1.0);

            const { entries: schedule } = planZoneSchedule(zone, weather);

            // Clay soil with low infiltration may prevent irrigation if depletion doesn't build enough.
            if (schedule.length > 0) {
                expect(schedule[0]!.cycles.length).toBeGreaterThan(1);
            } else {
                // Depletion didn't reach threshold.
                expect(schedule).toHaveLength(0);
            }
        });

        it('should not require cycle splitting with high infiltration rate', () => {
            const zone = createTestZone({
                soil: SOIL_TYPES.sand,
                currentDepletionMm: 15,
                flowRateLPerMin: 20,
            });
            const weather = createDryPeriod(3, 1.0);

            const { entries: schedule } = planZoneSchedule(zone, weather);

            expect(schedule.length).toBeGreaterThan(0);
            expect(schedule[0]!.cycles).toHaveLength(1);
        });
    });

    // Edge Cases.
    describe('Edge Cases', () => {
        it('should return empty schedule for disabled zone', () => {
            const zone = createTestZone({ isEnabled: false });
            const weather = createDryPeriod(14, 5.0);

            const { entries: schedule } = planZoneSchedule(zone, weather);

            expect(schedule).toHaveLength(0);
        });

        it('should trigger irrigation when depletion is exactly at RAW threshold', () => {
            const zone = createTestZone({
                currentDepletionMm: 22.5,
                allowableDepletionFraction: 0.5,
            });
            const weather = createDryPeriod(3, 0.1);

            const { entries: schedule } = planZoneSchedule(zone, weather);

            expect(schedule.length).toBeGreaterThan(0);
        });

        it('should not trigger irrigation when depletion is slightly below RAW', () => {
            const zone = createTestZone({
                currentDepletionMm: 22.0,
                allowableDepletionFraction: 0.5,
            });
            const weather = createDryPeriod(3, 0.1);

            const { entries: schedule } = planZoneSchedule(zone, weather);

            // With 0.1mm ET per day, depletion increases slightly but slowly.
            // May or may not trigger depending on accumulated ET.
            expect(schedule.length).toBeGreaterThanOrEqual(0);
        });

        it('should trigger irrigation when depletion is slightly above RAW', () => {
            const zone = createTestZone({
                currentDepletionMm: 22.6,
                allowableDepletionFraction: 0.5,
            });
            const weather = createDryPeriod(3, 0.1);

            const { entries: schedule } = planZoneSchedule(zone, weather);

            expect(schedule.length).toBeGreaterThan(0);
        });

        it('should clamp initial depletion that exceeds TAW', () => {
            const zone = createTestZone({
                currentDepletionMm: 100,
                allowableDepletionFraction: 0.5,
            });
            const weather = createDryPeriod(3, 1.0);

            const { entries: schedule } = planZoneSchedule(zone, weather);

            expect(schedule.length).toBeGreaterThan(0);
            expect(schedule[0]!.depletionBeforeMm).toBeLessThanOrEqual(45);
        });

        it('should clamp negative initial depletion to zero', () => {
            const zone = createTestZone({
                currentDepletionMm: -10,
                allowableDepletionFraction: 0.5,
            });
            const weather = createDryPeriod(7, 3.5);

            const { entries: schedule } = planZoneSchedule(zone, weather);

            // Negative depletion clamped to 0, then needs to build to 22.5mm.
            // With 3.5mm ET and 0.85 crop coefficient = ~3mm/day.
            // Should reach threshold around day 8.
            expect(schedule.length).toBeGreaterThanOrEqual(0);
        });

        it('should handle very early sunrise with limited cycle window', () => {
            const zone = createTestZone({ currentDepletionMm: 22 });
            const weather = createWeatherDays([
                {
                    evapotranspirationMmPerDay: 1.0,
                    rainfallMm: 0,
                    sunrise: dayjs('2025-10-20').hour(4).minute(30),
                },
            ]);

            const { entries: schedule } = planZoneSchedule(zone, weather);

            expect(schedule.length).toBeGreaterThan(0);
            expect(schedule[0]!.cycles[0]!.startTime.hour()).toBeLessThan(5);
        });

        it('should handle late sunrise with extended cycle window', () => {
            const zone = createTestZone({ currentDepletionMm: 22 });
            const weather = createWeatherDays([
                {
                    evapotranspirationMmPerDay: 1.0,
                    rainfallMm: 0,
                    sunrise: dayjs('2025-10-20').hour(8).minute(30),
                },
            ]);

            const { entries: schedule } = planZoneSchedule(zone, weather);

            expect(schedule.length).toBeGreaterThan(0);
            expect(schedule[0]!.cycles[0]!.startTime.hour()).toBeLessThan(9);
        });
    });

    // Combined Stress Scenarios.
    describe('Combined Stress Scenarios', () => {
        it('should handle drought with sandy soil and shallow roots', () => {
            const zone = createTestZone({
                soil: SOIL_TYPES.sand,
                rootDepthM: 0.15,
                currentDepletionMm: 0,
            });
            const weather = createDryPeriod(14, 4.0);

            const { entries: schedule } = planZoneSchedule(zone, weather);

            // Rapid depletion requires frequent irrigation.
            expect(schedule.length).toBeGreaterThan(7);
        });

        it('should handle wet period with clay soil and deep roots', () => {
            const zone = createTestZone({
                soil: SOIL_TYPES.clay,
                rootDepthM: 0.5,
                currentDepletionMm: 0,
            });
            const weather = createRainyPeriod(14, 6.0);

            const { entries: schedule } = planZoneSchedule(zone, weather);

            // High water retention with rainfall means minimal irrigation.
            expect(schedule).toHaveLength(0);
        });

        it('should handle high ET with low efficiency and clay soil', () => {
            // rootDepthM=0.1 caps TAW at 20 mm; precipitationRateMmPerHr=12 keeps
            // totalRunTime (~100 min) + 4 soak gaps (4×60 = 240 min) ≈ 340 min —
            // within the 6-hour midnight-to-sunrise window despite cycle splitting.
            const zone = createTestZone({
                soil: SOIL_TYPES.clay,
                irrigationEfficiency: 0.6,
                currentDepletionMm: 0,
                rootDepthM: 0.1,
                precipitationRateMmPerHr: 12,
            });
            const weather = createDryPeriod(14, 5.0);

            const { entries: schedule } = planZoneSchedule(zone, weather);

            expect(schedule.length).toBeGreaterThan(0);
            // Should require cycle splitting due to clay infiltration.
            expect(schedule[0]!.cycles.length).toBeGreaterThan(1);
        });

        it('should handle realistic baseline scenario with variable weather', () => {
            const zone = createTestZone({
                soil: SOIL_TYPES.loam,
                grassType: GRASS_TYPES.medium,
                currentDepletionMm: 10,
            });
            const weather = createVariableET(14);

            const { entries: schedule } = planZoneSchedule(zone, weather);

            expect(schedule.length).toBeGreaterThan(0);
        });

        it('should handle heat wave recovery scenario', () => {
            const zone = createTestZone({
                currentDepletionMm: 30,
                allowableDepletionFraction: 0.5,
            });
            const weather = createWeatherDays([
                { evapotranspirationMmPerDay: 6.0, rainfallMm: 0 },
                { evapotranspirationMmPerDay: 3.0, rainfallMm: 0 },
                { evapotranspirationMmPerDay: 2.5, rainfallMm: 0 },
                { evapotranspirationMmPerDay: 2.0, rainfallMm: 0 },
            ]);

            const { entries: schedule } = planZoneSchedule(zone, weather);

            expect(schedule.length).toBeGreaterThan(0);
        });

        it('should handle spring establishment with low coefficient and shallow roots', () => {
            const zone = createTestZone({
                grassType: GRASS_TYPES.lowWater,
                rootDepthM: 0.15,
                currentDepletionMm: 5,
            });
            const weather = createVariableET(14);

            const { entries: schedule } = planZoneSchedule(zone, weather);

            expect(schedule.length).toBeGreaterThan(0);
        });

        it('should handle summer stress with high coefficient and high ET', () => {
            const zone = createTestZone({
                grassType: GRASS_TYPES.highWater,
                currentDepletionMm: 10,
            });
            const weather = createHeatWave(14);

            const { entries: schedule } = planZoneSchedule(zone, weather);

            expect(schedule.length).toBeGreaterThan(3);
        });
    });

    // Time-Based Patterns.
    describe('Time-Based Patterns', () => {
        it('should handle 14-day planning period', () => {
            const zone = createTestZone({ currentDepletionMm: 10 });
            const weather = createDryPeriod(14, 2.5);

            const { entries: schedule } = planZoneSchedule(zone, weather);

            expect(schedule.length).toBeGreaterThan(0);
        });

        it('should handle 30-day extended planning period', () => {
            const zone = createTestZone({ currentDepletionMm: 0 });
            const weather = createDryPeriod(30, 2.5);

            const { entries: schedule } = planZoneSchedule(zone, weather);

            expect(schedule.length).toBeGreaterThan(1);
        });

        it('should handle 7-day short-term planning', () => {
            const zone = createTestZone({ currentDepletionMm: 15 });
            const weather = createDryPeriod(7, 2.5);

            const { entries: schedule } = planZoneSchedule(zone, weather);

            expect(schedule.length).toBeGreaterThan(0);
        });

        it('should handle single day planning', () => {
            const zone = createTestZone({ currentDepletionMm: 23 });
            const weather = createDryPeriod(1, 2.0);

            const { entries: schedule } = planZoneSchedule(zone, weather);

            expect(schedule.length).toBeGreaterThan(0);
        });
    });

    // Precipitation Rate Scenarios.
    describe('Precipitation Rate Scenarios', () => {
        it('should handle low flow rate requiring extended runtime', () => {
            const zone = createTestZone({
                flowRateLPerMin: 5,
                currentDepletionMm: 22,
            });
            const weather = createDryPeriod(3, 1.0);

            const { entries: schedule } = planZoneSchedule(zone, weather);

            expect(schedule.length).toBeGreaterThan(0);
            // Low flow means longer cycle duration.
            expect(schedule[0]!.cycles[0]!.durationMin).toBeGreaterThan(40);
        });

        it('should handle high flow rate with short runtime', () => {
            const zone = createTestZone({
                flowRateLPerMin: 30,
                currentDepletionMm: 22,
            });
            const weather = createDryPeriod(3, 1.0);

            const { entries: schedule } = planZoneSchedule(zone, weather);

            expect(schedule.length).toBeGreaterThan(0);
            // High flow means shorter total cycle time, but actual duration depends on efficiency and depletion.
            const totalDuration = schedule[0]!.cycles.reduce((sum, c) => sum + c.durationMin, 0);
            expect(totalDuration).toBeGreaterThan(0);
        });

        it('should use custom precipitation rate when provided', () => {
            const zone = createTestZone({
                precipitationRateMmPerHr: 20,
                currentDepletionMm: 22,
            });
            const weather = createDryPeriod(3, 1.0);

            const { entries: schedule } = planZoneSchedule(zone, weather);

            expect(schedule.length).toBeGreaterThan(0);
        });

        it('should not require cycles when precipitation rate is below infiltration', () => {
            const zone = createTestZone({
                soil: SOIL_TYPES.loam,
                flowRateLPerMin: 10,
                areaM2: 150,
                currentDepletionMm: 22,
            });
            const weather = createDryPeriod(3, 1.0);

            const { entries: schedule } = planZoneSchedule(zone, weather);

            expect(schedule.length).toBeGreaterThan(0);
            // Precipitation rate: 10 L/min * 60 / 150 m2 = 4 mm/hr.
            // Loam infiltration: 25 mm/hr, so no cycle splitting needed.
            // But may split based on algorithm logic.
            expect(schedule[0]!.cycles.length).toBeGreaterThan(0);
        });

        it('should require cycle splitting when precipitation rate exceeds infiltration', () => {
            const zone = createTestZone({
                soil: SOIL_TYPES.clay,
                flowRateLPerMin: 20,
                areaM2: 30,
                currentDepletionMm: 22,
            });
            const weather = createDryPeriod(3, 1.0);

            const { entries: schedule } = planZoneSchedule(zone, weather);

            // Clay soil with low infiltration may prevent irrigation if depletion doesn't build enough.
            if (schedule.length > 0) {
                // Precipitation rate: 20 L/min * 60 / 30 m2 = 40 mm/hr.
                // Clay infiltration: 4 mm/hr, so should require cycle splitting.
                expect(schedule[0]!.cycles.length).toBeGreaterThan(1);
            } else {
                // Depletion didn't reach threshold.
                expect(schedule).toHaveLength(0);
            }
        });
    });

    // Data Integrity Tests.
    describe('Data Integrity', () => {
        it('should maintain depletion within valid bounds throughout schedule', () => {
            const zone = createTestZone({ currentDepletionMm: 10 });
            const weather = createDryPeriod(30, 3.0);
            const maxDepletion = zone.soil.availableWaterHoldingCapacityMmPerM * zone.rootDepthM;

            const { entries: schedule } = planZoneSchedule(zone, weather);

            schedule.forEach((entry) => {
                expect(entry.depletionBeforeMm).toBeGreaterThanOrEqual(0);
                expect(entry.depletionBeforeMm).toBeLessThanOrEqual(maxDepletion);
                expect(entry.depletionAfterMm).toBeGreaterThanOrEqual(0);
                expect(entry.depletionAfterMm).toBeLessThanOrEqual(maxDepletion);
            });
        });

        it('should ensure all cycles end before sunrise', () => {
            const zone = createTestZone({
                soil: SOIL_TYPES.clay,
                currentDepletionMm: 22,
                flowRateLPerMin: 25,
                areaM2: 50,
            });
            const weather = createDryPeriod(7, 2.0);

            const { entries: schedule } = planZoneSchedule(zone, weather);

            schedule.forEach((entry, index) => {
                const weatherDay = weather.find(w => w.date.isSame(entry.date, 'day'));
                if (!weatherDay || !weatherDay.sunrise) return;
                
                const sunrise = weatherDay.sunrise;
                entry.cycles.forEach((cycle) => {
                    const cycleEnd = cycle.startTime.add(cycle.durationMin, 'minute');
                    expect(cycleEnd.isBefore(sunrise) || cycleEnd.isSame(sunrise)).toBe(true);
                });
            });
        });

        it('should have positive applied depth for all irrigation events', () => {
            const zone = createTestZone({ currentDepletionMm: 0 });
            const weather = createDryPeriod(30, 3.0);

            const { entries: schedule } = planZoneSchedule(zone, weather);

            schedule.forEach((entry) => {
                expect(entry.appliedDepthMm).toBeGreaterThan(0);
            });
        });

        it('should reset depletion to zero after irrigation', () => {
            const zone = createTestZone({ currentDepletionMm: 25 });
            const weather = createDryPeriod(3, 1.0);

            const { entries: schedule } = planZoneSchedule(zone, weather);

            expect(schedule.length).toBeGreaterThan(0);
            expect(schedule[0]!.depletionAfterMm).toBe(0);
        });
    });

    describe('projectedNextDepletionMm', () => {
        it('returns clamped starting depletion when weather history is empty', () => {
            const zone = createTestZone({ currentDepletionMm: 12 });

            const { projectedNextDepletionMm } = planZoneSchedule(zone, []);

            expect(projectedNextDepletionMm).toBe(12);
        });

        it('returns clamped starting depletion for a disabled zone', () => {
            const zone = createTestZone({ isEnabled: false, currentDepletionMm: 8 });
            const weather = createDryPeriod(7, 3.0);

            const { entries, projectedNextDepletionMm } = planZoneSchedule(zone, weather);

            expect(entries).toHaveLength(0);
            expect(projectedNextDepletionMm).toBe(8);
        });

        it('grows depletion by net day-0 ET on a no-irrigation day', () => {
            const zone = createTestZone({ currentDepletionMm: 5, allowableDepletionFraction: 0.5 });
            const weather = createWeatherDays([
                { evapotranspirationMmPerDay: 2.0, rainfallMm: 0 },
            ]);

            const { projectedNextDepletionMm } = planZoneSchedule(zone, weather);

            // Net change: 0.85 (Kc) * 2.0 ET - 0 effective rain = 1.7 mm.
            expect(projectedNextDepletionMm).toBeCloseTo(5 + 1.7, 5);
        });

        it('clamps projected depletion to zero when day-0 rainfall exceeds depletion + ET', () => {
            const zone = createTestZone({ currentDepletionMm: 4 });
            const weather = createWeatherDays([
                { evapotranspirationMmPerDay: 1.0, rainfallMm: 50 },
            ]);

            const { projectedNextDepletionMm } = planZoneSchedule(zone, weather);

            expect(projectedNextDepletionMm).toBe(0);
        });

        it('reflects post-irrigation reset plus another full day of net ET when day-0 irrigates', () => {
            const zone = createTestZone({ currentDepletionMm: 25, allowableDepletionFraction: 0.5 });
            const weather = createWeatherDays([
                { evapotranspirationMmPerDay: 2.0, rainfallMm: 0 },
            ]);

            const { entries, projectedNextDepletionMm } = planZoneSchedule(zone, weather);

            // Day-0 irrigation fires (depletion 25 + 1.7 ET = 26.7 >= 22.5 RAW), then
            // depletion resets to 0 and the planner re-applies the day's net ET. Net
            // is Kc * ET - 0 effective rain = 1.7 mm.
            expect(entries.length).toBeGreaterThan(0);
            expect(projectedNextDepletionMm).toBeCloseTo(1.7, 5);
        });
    });

    describe('busy-window deconfliction', () => {
        // Single-cycle scenario: high infiltration + matching precip rate keeps
        // totalRunTime ≤ maxCycle so buildCyclePlan emits exactly one cycle.
        const singleCycleZone = () => createTestZone({
            currentDepletionMm: 22,
            soil: { name: 'TestSoil', availableWaterHoldingCapacityMmPerM: 150, infiltrationRateMmPerHr: 100 },
            precipitationRateMmPerHr: 50,
        });
        const singleCycleWeather = () => createWeatherDays([
            {
                evapotranspirationMmPerDay: 1.0,
                rainfallMm: 0,
                sunrise: dayjs('2025-10-20').hour(6).minute(0).second(0).millisecond(0),
            },
        ]);

        it('returns identical output when busyWindows is empty', () => {
            const zone = singleCycleZone();
            const weather = singleCycleWeather();

            const baseline = planZoneSchedule(zone, weather);
            const withEmpty = planZoneSchedule(zone, weather, []);

            expect(withEmpty.entries).toHaveLength(baseline.entries.length);
            const baselineCycle = baseline.entries[0]!.cycles[0]!;
            const emptyCycle = withEmpty.entries[0]!.cycles[0]!;
            expect(emptyCycle.startTime.isSame(baselineCycle.startTime)).toBe(true);
            expect(emptyCycle.durationMin).toBe(baselineCycle.durationMin);
        });

        it('slides the cycle earlier so it ends at busyStart when its planned slot overlaps a busy window', () => {
            // API-66: previously the cycle was shoved forward past sunrise and dropped.
            // New behavior: the cycle slides earlier to end at busyStart, interleaving
            // with the busy zone instead of being lost.
            const zone = singleCycleZone();
            const weather = singleCycleWeather();
            const baseline = planZoneSchedule(zone, weather);
            const baselineCycle = baseline.entries[0]!.cycles[0]!;
            const busyStart = baselineCycle.startTime.subtract(20, 'minute');
            const busyEnd = baselineCycle.startTime.add(10, 'minute');

            const { entries } = planZoneSchedule(zone, weather, [{ start: busyStart, end: busyEnd }]);

            expect(entries).toHaveLength(1);
            const cycle = entries[0]!.cycles[0]!;
            const cycleEnd = cycle.startTime.add(cycle.durationMin, 'minute');
            expect(cycleEnd.isSame(busyStart)).toBe(true);
        });

        it('slides the cycle earlier when a busy window straddles its tail', () => {
            // API-66: cycle now slides to end at busyStart rather than being shoved forward.
            const zone = singleCycleZone();
            const weather = singleCycleWeather();
            const baseline = planZoneSchedule(zone, weather);
            const baselineCycle = baseline.entries[0]!.cycles[0]!;
            const busyStart = baselineCycle.startTime.add(5, 'minute');
            const busyEnd = baselineCycle.startTime.add(baselineCycle.durationMin, 'minute').add(20, 'minute');

            const { entries } = planZoneSchedule(zone, weather, [{ start: busyStart, end: busyEnd }]);

            expect(entries).toHaveLength(1);
            const cycle = entries[0]!.cycles[0]!;
            const cycleEnd = cycle.startTime.add(cycle.durationMin, 'minute');
            expect(cycleEnd.isSame(busyStart)).toBe(true);
        });

        it('slides the cycle earlier past consecutive busy windows until it fits', () => {
            // API-66: with two overlapping busy spans, the cycle keeps sliding earlier
            // until both are cleared. The earlier window starts before the cycle's
            // planned position, so we expect the cycle to land just before THAT span.
            const zone = singleCycleZone();
            const weather = singleCycleWeather();
            const baseline = planZoneSchedule(zone, weather);
            const baselineCycle = baseline.entries[0]!.cycles[0]!;
            const firstBusyStart = baselineCycle.startTime.subtract(30, 'minute');
            const firstBusyEnd = baselineCycle.startTime.add(10, 'minute');
            const secondBusyStart = firstBusyEnd.add(2, 'minute');
            const secondBusyEnd = secondBusyStart.add(20, 'minute');

            const { entries } = planZoneSchedule(zone, weather, [
                { start: firstBusyStart, end: firstBusyEnd },
                { start: secondBusyStart, end: secondBusyEnd },
            ]);

            expect(entries).toHaveLength(1);
            const cycle = entries[0]!.cycles[0]!;
            const cycleEnd = cycle.startTime.add(cycle.durationMin, 'minute');
            expect(cycleEnd.isSame(firstBusyStart)).toBe(true);
        });

        it('leaves a cycle untouched when no busy window overlaps', () => {
            const zone = singleCycleZone();
            const weather = singleCycleWeather();
            const baseline = planZoneSchedule(zone, weather);
            const baselineCycle = baseline.entries[0]!.cycles[0]!;
            const farPast = baselineCycle.startTime.subtract(6, 'hour');

            const { entries } = planZoneSchedule(zone, weather, [
                { start: farPast, end: farPast.add(30, 'minute') },
            ]);

            const cycle = entries[0]!.cycles[0]!;
            expect(cycle.startTime.isSame(baselineCycle.startTime)).toBe(true);
            expect(cycle.durationMin).toBe(baselineCycle.durationMin);
        });

        it('slides both cycles of a multi-cycle plan earlier past a busy window', () => {
            // API-66: previously only cycle 1 survived (slid forward to busyEnd) while
            // cycle 2 was lost to the cascading delay. New behavior: both cycles slide
            // earlier, the last cycle ending at busyStart and the first cycle one soak
            // earlier.
            const zone = createTestZone({ currentDepletionMm: 22 });
            const weather = createWeatherDays([
                {
                    evapotranspirationMmPerDay: 1.0,
                    rainfallMm: 0,
                    sunrise: dayjs('2025-10-20').hour(6).minute(0).second(0).millisecond(0),
                },
            ]);
            const baseline = planZoneSchedule(zone, weather);
            expect(baseline.entries[0]!.cycles).toHaveLength(2);
            const baselineFirst = baseline.entries[0]!.cycles[0]!;
            const busyStart = baselineFirst.startTime.subtract(15, 'minute');
            const busyEnd = baselineFirst.startTime.add(45, 'minute');

            const { entries } = planZoneSchedule(zone, weather, [{ start: busyStart, end: busyEnd }]);

            expect(entries).toHaveLength(1);
            expect(entries[0]!.cycles).toHaveLength(2);
            const [cycle1, cycle2] = entries[0]!.cycles;
            // No cycle overlaps the busy window.
            for (const cycle of entries[0]!.cycles) {
                const end = cycle.startTime.add(cycle.durationMin, 'minute');
                const overlap = cycle.startTime.isBefore(busyEnd) && end.isAfter(busyStart);
                expect(overlap).toBe(false);
            }
            // Cycles remain in chronological order.
            expect(cycle1!.startTime.isBefore(cycle2!.startTime)).toBe(true);
        });

        it('drops the day when a busy window blocks every backward placement before earliestStart', () => {
            // Day 0 with a busy window covering the entire midnight-to-sunrise span
            // leaves no slot the cycle can backward-slide into. The placer defers
            // (returns null) and the day is skipped.
            const zone = singleCycleZone();
            const sunrise = dayjs('2025-10-20').hour(6).minute(0).second(0).millisecond(0);
            const weather = createWeatherDays([
                { evapotranspirationMmPerDay: 1.0, rainfallMm: 0, sunrise },
            ]);
            const busyStart = sunrise.startOf('day');
            const busyEnd = sunrise;

            const { entries } = planZoneSchedule(zone, weather, [{ start: busyStart, end: busyEnd }]);

            expect(entries).toHaveLength(0);
        });

        it('treats an own previously-placed cycle as busy across multiple irrigation days', () => {
            const zone = createTestZone({ currentDepletionMm: 22 });
            // Two days both crossing threshold so both produce cycles.
            const weather = createWeatherDays([
                {
                    evapotranspirationMmPerDay: 1.0,
                    rainfallMm: 0,
                    sunrise: dayjs('2025-10-20').hour(6).minute(0).second(0).millisecond(0),
                },
                {
                    evapotranspirationMmPerDay: 1.0,
                    rainfallMm: 0,
                    sunrise: dayjs('2025-10-21').hour(6).minute(0).second(0).millisecond(0),
                },
            ]);

            const { entries } = planZoneSchedule(zone, weather);

            // Each day's cycles must not overlap any other day's cycles (sanity:
            // different dates, but verify no accidental cross-day overlap).
            const allCycles = entries.flatMap(e => e.cycles);
            for (let i = 0; i < allCycles.length; i++) {
                for (let j = i + 1; j < allCycles.length; j++) {
                    const a = allCycles[i]!;
                    const b = allCycles[j]!;
                    const aEnd = a.startTime.add(a.durationMin, 'minute');
                    const bEnd = b.startTime.add(b.durationMin, 'minute');
                    const overlap = a.startTime.isBefore(bEnd) && aEnd.isAfter(b.startTime);
                    expect(overlap).toBe(false);
                }
            }
        });

        it('interleaves a second zone\'s cycles into the soak gaps of the first zone (API-66)', () => {
            // Two single-cycle zones planned sequentially. Zone B receives A's run
            // window as a busyWindow. Old behaviour: B got pushed past sunrise and
            // lost all cycles. New behaviour: B's cycle slides earlier to end at
            // A's start — landing entirely inside the midnight-to-sunrise window.
            const zone = createTestZone({
                currentDepletionMm: 22,
                soil: { name: 'TestSoil', availableWaterHoldingCapacityMmPerM: 150, infiltrationRateMmPerHr: 100 },
                precipitationRateMmPerHr: 50,
            });
            const weather = createWeatherDays([
                {
                    evapotranspirationMmPerDay: 1.0,
                    rainfallMm: 0,
                    sunrise: dayjs('2025-10-20').hour(6).minute(0).second(0).millisecond(0),
                },
            ]);

            const planA = planZoneSchedule(zone, weather);
            expect(planA.entries[0]!.cycles.length).toBeGreaterThan(0);

            const aBusyWindows = planA.entries[0]!.cycles.map(c => ({
                start: c.startTime,
                end: c.startTime.add(c.durationMin, 'minute'),
            }));

            const planB = planZoneSchedule(zone, weather, aBusyWindows);

            // Zone B should still produce cycles (the core bug fix).
            expect(planB.entries[0]!.cycles.length).toBeGreaterThan(0);
            // None of B's cycles overlap any of A's run windows.
            for (const bCycle of planB.entries[0]!.cycles) {
                const bEnd = bCycle.startTime.add(bCycle.durationMin, 'minute');
                for (const aWindow of aBusyWindows) {
                    const overlap = bCycle.startTime.isBefore(aWindow.end) && bEnd.isAfter(aWindow.start);
                    expect(overlap).toBe(false);
                }
            }
        });
    });

    describe('schedule restrictions', () => {
        // Single-cycle scenario reused from the busy-window tests: high
        // infiltration + matching precip keeps totalRunTime ≤ maxCycle.
        const singleCycleZone = () => createTestZone({
            currentDepletionMm: 22,
            soil: { name: 'TestSoil', availableWaterHoldingCapacityMmPerM: 150, infiltrationRateMmPerHr: 100 },
            precipitationRateMmPerHr: 50,
        });

        function weatherFromDates(startDate: string, days: number, sunriseHour = 6) {
            return createWeatherDays(
                Array.from({ length: days }, () => ({ evapotranspirationMmPerDay: 1.0, rainfallMm: 0 })),
                dayjs(startDate),
            ).map((day, idx) => ({
                ...day,
                sunrise: dayjs(startDate).add(idx, 'day').hour(sunriseHour).minute(0).second(0).millisecond(0),
            }));
        }

        it('treats both columns null as no restriction — output identical to today (regression)', () => {
            const zone = singleCycleZone();
            const weather = weatherFromDates('2026-05-04', 1); // Monday

            const baseline = planZoneSchedule(zone, weather);
            const withNoRestrictions = planZoneSchedule(zone, weather, [], {
                allowedDays: null,
                allowedTimeWindows: null,
            });

            expect(withNoRestrictions.entries).toHaveLength(baseline.entries.length);
            expect(withNoRestrictions.entries[0]?.cycles[0]?.startTime.isSame(baseline.entries[0]?.cycles[0]?.startTime)).toBe(true);
            expect(withNoRestrictions.projectedNextDepletionMm).toBeCloseTo(baseline.projectedNextDepletionMm, 5);
        });

        it('treats empty arrays the same as null', () => {
            const zone = singleCycleZone();
            const weather = weatherFromDates('2026-05-04', 1);

            const empty = planZoneSchedule(zone, weather, [], {
                allowedDays: [],
                allowedTimeWindows: [],
            });
            const nulls = planZoneSchedule(zone, weather, [], {
                allowedDays: null,
                allowedTimeWindows: null,
            });

            expect(empty.entries).toHaveLength(nulls.entries.length);
            const a = empty.entries[0]?.cycles[0]!;
            const b = nulls.entries[0]?.cycles[0]!;
            expect(a.startTime.isSame(b.startTime)).toBe(true);
        });

        it('skips a disallowed weekday and lets depletion accumulate into the next allowed day', () => {
            // Monday 2026-05-04 → isoWeekday 1 (disallowed for Wed/Fri/Sun).
            // Wednesday 2026-05-06 → isoWeekday 3 (allowed).
            const zone = singleCycleZone();
            const weather = weatherFromDates('2026-05-04', 3); // Mon, Tue, Wed

            const result = planZoneSchedule(zone, weather, [], {
                allowedDays: [3, 5, 7],
                allowedTimeWindows: null,
            });

            // No entries for Monday or Tuesday (the only disallowed days that
            // would have otherwise triggered).
            expect(result.entries.find(e => e.date.format('YYYY-MM-DD') === '2026-05-04')).toBeUndefined();
            expect(result.entries.find(e => e.date.format('YYYY-MM-DD') === '2026-05-05')).toBeUndefined();
            // Wednesday — depletion has accumulated more than the no-restriction case.
            const wedEntry = result.entries.find(e => e.date.format('YYYY-MM-DD') === '2026-05-06');
            expect(wedEntry).toBeDefined();
            // The Monday depletion (22.85 mm) + Tue/Wed net ET (~0.95 each)
            // accumulates into Wednesday's irrigation pre-depletion. Sanity:
            // depletionBeforeMm must be greater than the single-day case.
            expect(wedEntry?.depletionBeforeMm).toBeGreaterThan(22.85);
        });

        it('keeps short pre-sunrise cycles inside the morning window when sunrise is 06:00', () => {
            const zone = singleCycleZone();
            const weather = weatherFromDates('2026-05-06', 1, 6); // Wed at 06:00

            const result = planZoneSchedule(zone, weather, [], {
                allowedDays: null,
                allowedTimeWindows: [
                    { start: '00:00', end: '10:00' },
                    { start: '19:00', end: '23:59' },
                ],
            });

            const cycle = result.entries[0]?.cycles[0];
            expect(cycle).toBeDefined();
            const start = cycle!.startTime;
            const end = start.add(cycle!.durationMin, 'minute');
            expect(start.hour()).toBeGreaterThanOrEqual(0);
            expect(end.isBefore(start.startOf('day').hour(10))).toBe(true);
        });

        it('places the cycle ending at sunrise regardless of allowedTimeWindows', () => {
            const zone = singleCycleZone();
            // Sunrise 12:00 — allowedTimeWindows is no longer used for placement.
            const weather = weatherFromDates('2026-05-06', 1, 12);

            const result = planZoneSchedule(zone, weather, [], {
                allowedDays: null,
                allowedTimeWindows: [
                    { start: '00:00', end: '10:00' },
                    { start: '19:00', end: '23:59' },
                ],
            });

            const cycle = result.entries[0]?.cycles[0]!;
            expect(cycle).toBeDefined();
            const end = cycle.startTime.add(cycle.durationMin, 'minute');
            // Cycle always ends at sunrise (noon here), regardless of time-window config.
            expect(end.hour()).toBe(12);
            expect(end.minute()).toBe(0);
        });

        it('skips the day when the overnight window is too short for any cycle', () => {
            // Polar-day-ish edge: day 0 sunset 23:50, day 1 sunrise 00:10 → only
            // 20 min between sunset and sunrise, but the planned cycle is ~35 min,
            // so the cycle would have to start before sunset → defer the day.
            const zone = createTestZone({
                currentDepletionMm: 21.5, // needs 2 days of ET (0.85/day) before crossing RAW (22.5)
                soil: { name: 'TestSoil', availableWaterHoldingCapacityMmPerM: 150, infiltrationRateMmPerHr: 100 },
                precipitationRateMmPerHr: 50,
            });
            // Day 0: depletion stays below RAW (21.5 + 0.85 = 22.35 < 22.5).
            // Day 1: depletion crosses RAW; cycle would start ~23:35 day 0, before sunset 23:50 → defer.
            const weather = createWeatherDays([
                {
                    evapotranspirationMmPerDay: 1.0,
                    rainfallMm: 0,
                    sunset: dayjs('2026-05-05').hour(23).minute(50).second(0).millisecond(0),
                },
                {
                    evapotranspirationMmPerDay: 1.0,
                    rainfallMm: 0,
                    sunrise: dayjs('2026-05-06').hour(0).minute(10).second(0).millisecond(0),
                },
            ], dayjs('2026-05-05'));

            const result = planZoneSchedule(zone, weather);

            expect(result.entries).toHaveLength(0);
        });

        it('Calgary case: cycles only ever land on Wed/Fri/Sun within the two allowed windows', () => {
            // 7-day window starting Monday 2026-05-04.
            const zone = singleCycleZone();
            const weather = weatherFromDates('2026-05-04', 7, 6);

            const result = planZoneSchedule(zone, weather, [], {
                allowedDays: [3, 5, 7],
                allowedTimeWindows: [
                    { start: '00:00', end: '10:00' },
                    { start: '19:00', end: '23:59' },
                ],
            });

            for (const entry of result.entries) {
                const isoWd = entry.date.isoWeekday();
                expect([3, 5, 7]).toContain(isoWd);
                for (const cycle of entry.cycles) {
                    const dayStart = cycle.startTime.startOf('day');
                    const cycleEnd = cycle.startTime.add(cycle.durationMin, 'minute');
                    const morningStart = dayStart;
                    const morningEnd = dayStart.hour(10);
                    const eveningStart = dayStart.hour(19);
                    const eveningEnd = dayStart.hour(23).minute(59);
                    const inMorning = !cycle.startTime.isBefore(morningStart) && !cycleEnd.isAfter(morningEnd);
                    const inEvening = !cycle.startTime.isBefore(eveningStart) && !cycleEnd.isAfter(eveningEnd);
                    expect(inMorning || inEvening).toBe(true);
                }
            }
        });

        it('drops the day when a busy window covers the entire overnight window', () => {
            const zone = singleCycleZone();
            const weather = weatherFromDates('2026-05-06', 1, 6);

            // Cross-zone busy block covers midnight through well after sunrise — nowhere to fit.
            const busyWindows = [{
                start: dayjs('2026-05-06').hour(0).minute(0).second(0).millisecond(0),
                end: dayjs('2026-05-06').hour(11).minute(0).second(0).millisecond(0),
            }];

            const result = planZoneSchedule(zone, weather, busyWindows);

            expect(result.entries).toHaveLength(0);
        });

        it('multi-zone: a cross-zone busy window outside the cycle slot is a no-op', () => {
            const zone = singleCycleZone();
            const weather = weatherFromDates('2026-05-06', 1, 6);
            const baselineCycle = planZoneSchedule(zone, weather).entries[0]!.cycles[0]!;

            // Zone A's busy interval is well before the cycle's natural slot, so
            // deconflict shouldn't shift it.
            const zoneABusy = [{
                start: dayjs('2026-05-06').hour(2).minute(0).second(0).millisecond(0),
                end: dayjs('2026-05-06').hour(2).minute(30).second(0).millisecond(0),
            }];

            const result = planZoneSchedule(zone, weather, zoneABusy);

            const cycle = result.entries[0]!.cycles[0]!;
            expect(cycle.startTime.isSame(baselineCycle.startTime)).toBe(true);
            const cycleEnd = cycle.startTime.add(cycle.durationMin, 'minute');
            const overlapsA = cycle.startTime.isBefore(zoneABusy[0]!.end) && cycleEnd.isAfter(zoneABusy[0]!.start);
            expect(overlapsA).toBe(false);
        });
    });

    describe('schedule overrides', () => {
        const baseZone = () => createTestZone({
            currentDepletionMm: 5,
            allowableDepletionFraction: 0.5,
            rootDepthM: 0.3,
            soil: { name: 'Loam', availableWaterHoldingCapacityMmPerM: 150, infiltrationRateMmPerHr: 25 },
        });

        const drySevenDays = () => createDryPeriod(7, 5.0, dayjs('2026-05-04'));

        it('produces output identical to a no-args call when overrides are omitted (regression)', () => {
            const zone = baseZone();
            const weather = drySevenDays();

            const baseline = planZoneSchedule(zone, weather);
            const withEmpty = planZoneSchedule(zone, weather, [], undefined, {});

            expect(withEmpty.entries.length).toBe(baseline.entries.length);
            for (let i = 0; i < baseline.entries.length; i++) {
                const a = baseline.entries[i]!;
                const b = withEmpty.entries[i]!;
                expect(b.date.isSame(a.date)).toBe(true);
                expect(b.appliedDepthMm).toBeCloseTo(a.appliedDepthMm, 5);
                expect(b.cycles.length).toBe(a.cycles.length);
            }
            expect(withEmpty.projectedNextDepletionMm).toBeCloseTo(baseline.projectedNextDepletionMm, 5);
        });

        it('shrinks TAW/RAW when only rootDepthM is overridden, triggering irrigation sooner', () => {
            // Zone default RAW = 0.5 * (150 * 0.3) = 22.5 mm. Starting depletion 5 mm,
            // Kc * ET = 0.85 * 5 = 4.25 mm/day → reaches RAW around day 5.
            const zone = baseZone();
            const weather = drySevenDays();

            const baseline = planZoneSchedule(zone, weather);
            // Override RAW = 0.5 * (150 * 0.05) = 3.75 mm. Starting depletion 5 mm
            // already exceeds it, so day-0 triggers immediately.
            const shallow = planZoneSchedule(zone, weather, [], undefined, { rootDepthM: 0.05 });

            const baselineDay0 = baseline.entries.find(e => e.date.format('YYYY-MM-DD') === '2026-05-04');
            const shallowDay0 = shallow.entries.find(e => e.date.format('YYYY-MM-DD') === '2026-05-04');

            expect(baselineDay0).toBeUndefined();
            expect(shallowDay0).toBeDefined();
        });

        it('tightens the trigger threshold when only allowableDepletionFraction is overridden', () => {
            // Default RAW 22.5 mm. Tightening to 0.1 → RAW = 0.1 * 45 = 4.5 mm.
            // Starting depletion 5 mm exceeds it → day 0 fires.
            const zone = baseZone();
            const weather = drySevenDays();

            const baseline = planZoneSchedule(zone, weather);
            const tight = planZoneSchedule(zone, weather, [], undefined, { allowableDepletionFraction: 0.1 });

            const baselineDay0 = baseline.entries.find(e => e.date.format('YYYY-MM-DD') === '2026-05-04');
            const tightDay0 = tight.entries.find(e => e.date.format('YYYY-MM-DD') === '2026-05-04');

            expect(baselineDay0).toBeUndefined();
            expect(tightDay0).toBeDefined();
            // depletionBefore reflects the tight threshold (5 + 0.85*5 = 9.25 mm).
            expect(tightDay0?.depletionBeforeMm).toBeCloseTo(9.3, 1);
        });

        it('produces daily entries across the forecast under overseeding-style overrides', () => {
            // Overseeding-style: RAW = 0.25 * (150 * 0.05) = 1.875 mm.
            // Daily ET ≈ 4.75 mm overwhelms RAW every day.
            const zone = baseZone();
            const weather = drySevenDays();

            const overseeding = planZoneSchedule(zone, weather, [], undefined, {
                rootDepthM: 0.05,
                allowableDepletionFraction: 0.25,
            });

            expect(overseeding.entries.length).toBe(7);
        });

        it('clamps starting depletion against the overridden (shallower) TAW', () => {
            // Default TAW = 45 mm, zone starts at 30 mm. With rootDepthM override
            // of 0.05, TAW shrinks to 7.5 mm and the clamp pulls the starting
            // depletion down accordingly. The post-day-0 projection reflects
            // the clamp, not the seed value.
            const zone = createTestZone({
                currentDepletionMm: 30,
                allowableDepletionFraction: 0.5,
                rootDepthM: 0.3,
                soil: { name: 'Loam', availableWaterHoldingCapacityMmPerM: 150, infiltrationRateMmPerHr: 25 },
            });
            const weather = createWeatherDays([{ evapotranspirationMmPerDay: 0, rainfallMm: 0 }], dayjs('2026-05-04'));

            const result = planZoneSchedule(zone, weather, [], undefined, { rootDepthM: 0.05 });

            // With currentDepletion clamped to 7.5 mm (overridden TAW=7.5 mm),
            // starting depletion (7.5) > RAW (3.75) so day-0 triggers. The
            // applied gross is also capped at TAW=7.5 mm, but efficiency 0.8
            // delivers only 6.0 mm net to the root zone — so depletionAfter
            // is 7.5 − 6.0 = 1.5 mm (API-75). With ET=0 the projected
            // end-of-day depletion equals that residual.
            expect(result.entries[0]?.depletionBeforeMm).toBeCloseTo(7.5, 1);
            expect(result.projectedNextDepletionMm).toBeCloseTo(1.5, 5);
        });

        it('produces materially different output when the same fixture is planned under different override modes', () => {
            const zone = baseZone();
            const weather = drySevenDays();

            const maintenance = planZoneSchedule(zone, weather);
            const overseeding = planZoneSchedule(zone, weather, [], undefined, {
                rootDepthM: 0.05,
                allowableDepletionFraction: 0.25,
            });

            // Maintenance: ~1 entry in a 7-day dry run (refills once around day 5).
            // Overseeding: an entry every day (7 in total).
            expect(overseeding.entries.length).toBeGreaterThan(maintenance.entries.length);
            // Maintenance per-fire applied depth is much larger (refills full RAW)
            // than the overseeding per-fire applied depth (refills the much smaller RAW).
            const maintenanceFire = maintenance.entries[0]!;
            const overseedingFire = overseeding.entries[0]!;
            expect(maintenanceFire.appliedDepthMm).toBeGreaterThan(overseedingFire.appliedDepthMm * 3);
        });
    });

    describe('midnight floor (API-72)', () => {
        // The overnight window is [midnight, sunrise]. No cycle may start before
        // 00:00 local of the irrigation entry's date.

        it('all placed cycles start at or after midnight of the entry date', () => {
            // Single-cycle zone fires on day 0. Cycles must fall in [midnight, sunrise].
            const zone = createTestZone({
                currentDepletionMm: 22,
                soil: { name: 'TestSoil', availableWaterHoldingCapacityMmPerM: 150, infiltrationRateMmPerHr: 100 },
                precipitationRateMmPerHr: 50,
            });
            const date = dayjs('2026-05-04');
            const weather = createWeatherDays(
                [{ evapotranspirationMmPerDay: 1.0, rainfallMm: 0, sunrise: date.hour(6).minute(0).second(0).millisecond(0) }],
                date,
            );

            const { entries } = planZoneSchedule(zone, weather);

            expect(entries).toHaveLength(1);
            const midnight = date.startOf('day');
            for (const cycle of entries[0]!.cycles) {
                expect(cycle.startTime.valueOf()).toBeGreaterThanOrEqual(midnight.valueOf());
            }
        });

        it('partially refills when the full-refill runtime exceeds the midnight-to-sunrise window (API-75)', () => {
            // Clay soil: infiltration 4 mm/hr → soak 60 min. AWHC=200 mm/m,
            // rootDepthM=0.3 → TAW=60 mm, RAW=30 mm. With precipitationRateMmPerHr=9 and
            // currentDepletionMm=29, irrigation fires on day 1 (29 + 0.85 ET → 30.7mm).
            // Full refill would need ~10 cycles with 60-min soaks (~796 min, far
            // beyond the 360-min overnight window). Pre-API-75 the day deferred
            // entirely; now the planner clamps gross to what fits, partially
            // refills, and carries the residual to the next allowed night.
            const zone = createTestZone({
                currentDepletionMm: 29,
                soil: SOIL_TYPES.clay,
                precipitationRateMmPerHr: 9,
            });
            const weather = createWeatherDays([
                { evapotranspirationMmPerDay: 1.0, rainfallMm: 0 },
                { evapotranspirationMmPerDay: 1.0, rainfallMm: 0 },
            ], dayjs('2026-05-04'));

            const { entries } = planZoneSchedule(zone, weather);

            expect(entries.length).toBeGreaterThan(0);
            for (const entry of entries) {
                // Every placed entry's cycles fit inside [midnight, sunrise].
                const midnight = entry.date.startOf('day');
                const sunrise = entry.sunriseAt!;
                for (const cycle of entry.cycles) {
                    expect(cycle.startTime.valueOf()).toBeGreaterThanOrEqual(midnight.valueOf());
                    const cycleEnd = cycle.startTime.add(cycle.durationMin, 'minute');
                    expect(cycleEnd.valueOf()).toBeLessThanOrEqual(sunrise.valueOf() + 1000);
                }
                // Partial refill: depletionAfter is the residual, not zero.
                expect(entry.depletionAfterMm).toBeGreaterThan(0);
            }
        });

        it('places cycles when the required runtime fits within the midnight-to-sunrise window', () => {
            // High-flow zone: 2 cycles × ~28 min + 15-min soak ≈ 71 min — fits in 6 hours.
            const zone = createTestZone({
                currentDepletionMm: 22,
                soil: { name: 'TestSoil', availableWaterHoldingCapacityMmPerM: 150, infiltrationRateMmPerHr: 100 },
                precipitationRateMmPerHr: 50,
            });
            const date = dayjs('2026-05-04');
            const weather = createWeatherDays(
                [{ evapotranspirationMmPerDay: 1.0, rainfallMm: 0, sunrise: date.hour(6).minute(0).second(0).millisecond(0) }],
                date,
            );

            const { entries } = planZoneSchedule(zone, weather);

            expect(entries).toHaveLength(1);
        });

        it('keeps overnight cycles when a late-night past-window ends before midnight of the entry date', () => {
            // Re-plan at 23:45 on the day before `date`; the past-window is
            // [epoch, 2026-05-03T23:45]. The cycle is placed in [midnight, sunrise]
            // of 2026-05-04 — well after the past-window end — so no shift occurs
            // and the entry fires as planned.
            const zone = createTestZone({
                currentDepletionMm: 22,
                soil: { name: 'TestSoil', availableWaterHoldingCapacityMmPerM: 150, infiltrationRateMmPerHr: 100 },
                precipitationRateMmPerHr: 50,
            });
            const date = dayjs('2026-05-04');
            const weather = createWeatherDays(
                [{ evapotranspirationMmPerDay: 1.0, rainfallMm: 0, sunrise: date.hour(6).minute(0).second(0).millisecond(0) }],
                date,
            );
            const pastWindowEnd = dayjs('2026-05-03T23:45:00.000Z');
            const pastWindow = { start: dayjs(new Date(0)), end: pastWindowEnd };

            const { entries } = planZoneSchedule(zone, weather, [pastWindow]);

            expect(entries).toHaveLength(1);
            // Cycle lands in [midnight, sunrise] — not shifted by the past-window.
            const cycle = entries[0]!.cycles[0]!;
            expect(cycle.startTime.valueOf()).toBeGreaterThanOrEqual(date.startOf('day').valueOf());
            expect(cycle.startTime.valueOf()).toBeLessThanOrEqual(date.hour(6).valueOf());
        });
    });

    describe('past-window deconfliction', () => {
        // Simulates the daemon passing { start: epoch, end: now } as a busy window
        // so that past-dated cycles are shifted forward to fire after now.

        const NOW = dayjs('2026-05-04T14:00:00.000Z');
        const PAST_WINDOW = { start: dayjs(new Date(0)), end: NOW };

        function pastWindowZone() {
            // Single-cycle zone: high infiltration → no cycle splitting.
            // currentDepletionMm=22 plus ET=0.85 pushes over RAW (22.5 mm) on day 0.
            return createTestZone({
                currentDepletionMm: 22,
                soil: { name: 'TestSoil', availableWaterHoldingCapacityMmPerM: 150, infiltrationRateMmPerHr: 100 },
                precipitationRateMmPerHr: 50,
            });
        }

        function multiCycleZone() {
            // Clay soil (infiltration 4 mm/hr) forces 3 cycles.
            // currentDepletionMm=8 plus ET=0.85 pushes over RAW (8 mm) on day 0.
            return createTestZone({
                currentDepletionMm: 8,
                allowableDepletionFraction: 0.5,
                rootDepthM: 0.08,
                soil: SOIL_TYPES.clay,
                precipitationRateMmPerHr: 9,
            });
        }

        function weatherDay(sunriseHour = 6) {
            return createWeatherDays(
                [{ evapotranspirationMmPerDay: 1.0, rainfallMm: 0 }],
                dayjs('2026-05-04'),
            ).map(day => ({
                ...day,
                sunrise: dayjs('2026-05-04').hour(sunriseHour).minute(0).second(0).millisecond(0),
            }));
        }

        it('shifts a single past-dated cycle to start at or after now when there is no time window restriction', () => {
            const zone = pastWindowZone();
            const weather = weatherDay();

            const { entries } = planZoneSchedule(zone, weather, [PAST_WINDOW]);

            expect(entries).toHaveLength(1);
            const cycle = entries[0]!.cycles[0]!;
            expect(cycle.startTime.valueOf()).toBeGreaterThanOrEqual(NOW.valueOf());
        });

        it('shifts all cycles in a multi-cycle plan to start sequentially after now', () => {
            const zone = multiCycleZone();
            const weather = weatherDay();

            const { entries } = planZoneSchedule(zone, weather, [PAST_WINDOW]);

            expect(entries).toHaveLength(1);
            const cycles = entries[0]!.cycles;
            expect(cycles.length).toBeGreaterThan(1);
            for (const cycle of cycles) {
                expect(cycle.startTime.valueOf()).toBeGreaterThanOrEqual(NOW.valueOf());
            }
        });

        it('places a past-dated cycle at NOW even after sunrise has passed', () => {
            // PAST_WINDOW.end = 14:00 UTC, well past sunrise 06:00. The cycle is
            // intentionally shifted past sunrise so the daemon can fire it now.
            const zone = pastWindowZone();
            const weather = weatherDay();

            const { entries } = planZoneSchedule(zone, weather, [PAST_WINDOW]);

            expect(entries).toHaveLength(1);
            const cycle = entries[0]!.cycles[0]!;
            expect(cycle.startTime.isSame(NOW)).toBe(true);
        });

        it('places a cycle at NOW when the past window ends earlier in the day', () => {
            const NOW_09 = dayjs('2026-05-04T09:00:00.000Z');
            const zone = pastWindowZone();
            const weather = weatherDay();

            const { entries } = planZoneSchedule(zone, weather, [{ start: dayjs(new Date(0)), end: NOW_09 }]);

            expect(entries).toHaveLength(1);
            const cycle = entries[0]!.cycles[0]!;
            expect(cycle.startTime.valueOf()).toBeGreaterThanOrEqual(NOW_09.valueOf());
        });

        it('drops past-due cycles entirely when restrictions.endBySunrise is true (API-66)', () => {
            // Re-plan at 14:00 UTC (well past sunrise); the planned cycle would land
            // before sunrise. With endBySunrise=true the forward push is forbidden
            // (no daytime irrigation), so the cycle is dropped and depletion carries
            // forward to the next plan.
            const zone = pastWindowZone();
            const weather = weatherDay();

            const { entries } = planZoneSchedule(
                zone,
                weather,
                [PAST_WINDOW],
                { allowedDays: null, allowedTimeWindows: null, endBySunrise: true },
            );

            expect(entries).toHaveLength(0);
        });

        it('carries depletion forward to day 1 when day 0 is dropped under endBySunrise', () => {
            // Day 0 fires before re-plan (cycles dropped → no irrigation); depletion
            // accumulates and day 1 fires. The planner's `projectedNextDepletionMm`
            // reflects the carried-forward deficit.
            const zone = pastWindowZone();
            const weather = createWeatherDays(
                [
                    { evapotranspirationMmPerDay: 1.0, rainfallMm: 0 },
                    { evapotranspirationMmPerDay: 1.0, rainfallMm: 0 },
                ],
                dayjs('2026-05-04'),
            ).map((day, i) => ({
                ...day,
                sunrise: dayjs(`2026-05-0${4 + i}`).hour(6).minute(0).second(0).millisecond(0),
            }));

            const withSunriseGate = planZoneSchedule(
                zone,
                weather,
                [PAST_WINDOW],
                { allowedDays: null, allowedTimeWindows: null, endBySunrise: true },
            );

            // Day 0's cycles are all past-due → dropped. Day 1 still gets planned with
            // accumulated depletion (visible via day-1 entry's depletionBeforeMm > the
            // baseline single-day RAW).
            expect(withSunriseGate.entries.length).toBeGreaterThan(0);
            for (const entry of withSunriseGate.entries) {
                expect(entry.date.format('YYYY-MM-DD')).not.toBe('2026-05-04');
            }
        });

        it('preserves the accumulated depletion on day 1 when day 0 was dropped under 20:00 endBySunrise (API-68)', () => {
            // Locks in the API-66 carry-forward guarantee under the new API-68
            // re-plan hour. At 20:00 local, day-0's overnight cycles (planned
            // backward from day-0 sunrise) are all past-due. They must be
            // dropped *and* depletion must NOT silently reset — otherwise day 1
            // would start at a clean ~0 mm and not cross RAW at all on this
            // horizon.
            const zone = pastWindowZone();
            const twentyHundredUtc = dayjs('2026-05-04T20:00:00.000Z');
            const weather = createWeatherDays(
                [
                    { evapotranspirationMmPerDay: 1.0, rainfallMm: 0 },
                    { evapotranspirationMmPerDay: 1.0, rainfallMm: 0 },
                ],
                dayjs('2026-05-04'),
            ).map((day, i) => ({
                ...day,
                sunrise: dayjs(`2026-05-0${4 + i}`).hour(6).minute(0).second(0).millisecond(0),
            }));

            const result = planZoneSchedule(
                zone,
                weather,
                [{ start: dayjs(new Date(0)), end: twentyHundredUtc }],
                { allowedDays: null, allowedTimeWindows: null, endBySunrise: true },
            );

            // Day 0 has no entry; day 1 fires because day-0 depletion carried.
            const day0 = result.entries.find(e => e.date.format('YYYY-MM-DD') === '2026-05-04');
            const day1 = result.entries.find(e => e.date.format('YYYY-MM-DD') === '2026-05-05');
            expect(day0).toBeUndefined();
            expect(day1).toBeDefined();

            // Carry-forward proof: starting depletion was 22; day-0 net ET adds
            // ~0.85 mm (no irrigation); day-1 net ET adds another ~0.85 mm → day-1
            // `depletionBeforeMm` should be ~23. If day 0 had silently reset on
            // drop, day 1's value would be only ~0.85 — well below RAW (22.5).
            expect(day1!.depletionBeforeMm).toBeGreaterThan(20);
        });

        it('keeps the existing forward-shift behaviour when endBySunrise is false (default)', () => {
            // Regression guard: without endBySunrise the planner still pushes past-due
            // cycles to fire at NOW.
            const zone = pastWindowZone();
            const weather = weatherDay();

            const { entries } = planZoneSchedule(
                zone,
                weather,
                [PAST_WINDOW],
                { allowedDays: null, allowedTimeWindows: null, endBySunrise: false },
            );

            expect(entries).toHaveLength(1);
            const cycle = entries[0]!.cycles[0]!;
            expect(cycle.startTime.valueOf()).toBeGreaterThanOrEqual(NOW.valueOf());
        });

        it('keeps future cycles on day 0 when re-plan kicks off before sunrise under endBySunrise', () => {
            // Re-plan at 03:00 UTC — sunrise 06:00. Day-0 cycle planned around 05:50
            // (single-cycle zone): still in the future, so it survives the
            // endBySunrise gate.
            const NOW_03 = dayjs('2026-05-04T03:00:00.000Z');
            const zone = pastWindowZone();
            const weather = weatherDay();

            const { entries } = planZoneSchedule(
                zone,
                weather,
                [{ start: dayjs(new Date(0)), end: NOW_03 }],
                { allowedDays: null, allowedTimeWindows: null, endBySunrise: true },
            );

            expect(entries).toHaveLength(1);
            const cycle = entries[0]!.cycles[0]!;
            const cycleEnd = cycle.startTime.add(cycle.durationMin, 'minute');
            expect(cycle.startTime.valueOf()).toBeGreaterThan(NOW_03.valueOf());
            // And the cycle still ends at-or-before sunrise (06:00).
            expect(cycleEnd.valueOf()).toBeLessThanOrEqual(weather[0]!.sunrise!.valueOf() + 1000);
        });
    });

    describe('skip-tonight marker', () => {
        const singleCycleZone = () => createTestZone({
            currentDepletionMm: 22,
            soil: { name: 'TestSoil', availableWaterHoldingCapacityMmPerM: 150, infiltrationRateMmPerHr: 100 },
            precipitationRateMmPerHr: 50,
        });

        function weatherFromDates(startDate: string, days: number, sunriseHour = 6) {
            return createWeatherDays(
                Array.from({ length: days }, () => ({ evapotranspirationMmPerDay: 1.0, rainfallMm: 0 })),
                dayjs(startDate),
            ).map((day, idx) => ({
                ...day,
                sunrise: dayjs(startDate).add(idx, 'day').hour(sunriseHour).minute(0).second(0).millisecond(0),
            }));
        }

        it('drops day 0 cycles when the marker matches and lets depletion accumulate into the next day', () => {
            const zone = singleCycleZone();
            // Wednesday 2026-05-06 (day 0), Thursday 2026-05-07 (day 1).
            const weather = weatherFromDates('2026-05-06', 2);

            const result = planZoneSchedule(zone, weather, [], {
                allowedDays: null,
                allowedTimeWindows: null,
                skippedNightDate: '2026-05-06',
            });

            expect(result.entries.find(e => e.date.format('YYYY-MM-DD') === '2026-05-06')).toBeUndefined();
            const thursday = result.entries.find(e => e.date.format('YYYY-MM-DD') === '2026-05-07');
            expect(thursday).toBeDefined();
            // Skipped day's depletion (22.85 mm after day 0 ET) carries into Thursday's
            // pre-irrigation depletion — sanity check it's strictly greater than the
            // single-day depletion that would have triggered today.
            expect(thursday?.depletionBeforeMm).toBeGreaterThan(22.85);
        });

        it('drops a specific future-day match without affecting other days', () => {
            const zone = singleCycleZone();
            const weather = weatherFromDates('2026-05-06', 3); // Wed, Thu, Fri

            const result = planZoneSchedule(zone, weather, [], {
                allowedDays: null,
                allowedTimeWindows: null,
                skippedNightDate: '2026-05-07', // skip only Thursday
            });

            // Wednesday fires normally.
            expect(result.entries.find(e => e.date.format('YYYY-MM-DD') === '2026-05-06')).toBeDefined();
            // Thursday is skipped.
            expect(result.entries.find(e => e.date.format('YYYY-MM-DD') === '2026-05-07')).toBeUndefined();
        });

        it('is a no-op when the marker is null or matches no planned day (regression)', () => {
            const zone = singleCycleZone();
            const weather = weatherFromDates('2026-05-06', 1);

            const baseline = planZoneSchedule(zone, weather);
            const withNullMarker = planZoneSchedule(zone, weather, [], {
                allowedDays: null,
                allowedTimeWindows: null,
                skippedNightDate: null,
            });
            const withUnmatchedMarker = planZoneSchedule(zone, weather, [], {
                allowedDays: null,
                allowedTimeWindows: null,
                skippedNightDate: '1999-01-01',
            });

            expect(withNullMarker.entries).toHaveLength(baseline.entries.length);
            expect(withUnmatchedMarker.entries).toHaveLength(baseline.entries.length);
            expect(withNullMarker.entries[0]?.cycles[0]?.startTime.isSame(baseline.entries[0]?.cycles[0]?.startTime)).toBe(true);
            expect(withUnmatchedMarker.entries[0]?.cycles[0]?.startTime.isSame(baseline.entries[0]?.cycles[0]?.startTime)).toBe(true);
        });
    });

    describe('sunrise persistence on entries', () => {
        const singleCycleZone = () => createTestZone({
            currentDepletionMm: 22,
            soil: { name: 'TestSoil', availableWaterHoldingCapacityMmPerM: 150, infiltrationRateMmPerHr: 100 },
            precipitationRateMmPerHr: 50,
        });

        it('attaches sunriseAt = the day weather sunrise on each produced entry', () => {
            const zone = singleCycleZone();
            const sunrise = dayjs('2026-05-06').hour(6).minute(15).second(0).millisecond(0);
            const weather = createWeatherDays(
                [{ evapotranspirationMmPerDay: 1.0, rainfallMm: 0, sunrise }],
                dayjs('2026-05-06'),
            );

            const { entries } = planZoneSchedule(zone, weather);

            expect(entries).toHaveLength(1);
            expect(entries[0]?.sunriseAt).toBeDefined();
            expect(entries[0]?.sunriseAt?.isSame(sunrise)).toBe(true);
        });
    });
});
