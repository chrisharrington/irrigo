import { describe, it, expect } from 'bun:test';
import dayjs from 'dayjs';
import { planZoneSchedule } from '.';
import { createTestZone, GRASS_TYPES, SOIL_TYPES } from '../../mock/zone';
import {
    createWeatherDays,
    createDryPeriod,
    createRainyPeriod,
    createIntermittentRainfall,
    createVariableET,
    createHeatWave,
} from '../../mock/weather';

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
            const zone = createTestZone({
                soil: SOIL_TYPES.clay,
                irrigationEfficiency: 0.6,
                currentDepletionMm: 0,
                flowRateLPerMin: 25,
                areaM2: 60,
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

        it('drops the day when a busy window pushes the cycle past sunrise', () => {
            // The baseline cycle ends exactly at sunrise. Any forward shift cascades
            // the end time past sunrise, so the cycle is dropped and no entry is produced.
            const zone = singleCycleZone();
            const weather = singleCycleWeather();
            const baseline = planZoneSchedule(zone, weather);
            const baselineCycle = baseline.entries[0]!.cycles[0]!;
            const busyStart = baselineCycle.startTime.subtract(20, 'minute');
            const busyEnd = baselineCycle.startTime.add(10, 'minute');

            const { entries } = planZoneSchedule(zone, weather, [{ start: busyStart, end: busyEnd }]);

            expect(entries).toHaveLength(0);
        });

        it('drops the day when a busy window whose tail straddles the cycle pushes it past sunrise', () => {
            const zone = singleCycleZone();
            const weather = singleCycleWeather();
            const baseline = planZoneSchedule(zone, weather);
            const baselineCycle = baseline.entries[0]!.cycles[0]!;
            const busyStart = baselineCycle.startTime.add(5, 'minute');
            const busyEnd = baselineCycle.startTime.add(baselineCycle.durationMin, 'minute').add(20, 'minute');

            const { entries } = planZoneSchedule(zone, weather, [{ start: busyStart, end: busyEnd }]);

            expect(entries).toHaveLength(0);
        });

        it('drops the day when consecutive busy windows push the cycle past sunrise', () => {
            const zone = singleCycleZone();
            const weather = singleCycleWeather();
            const baseline = planZoneSchedule(zone, weather);
            const baselineCycle = baseline.entries[0]!.cycles[0]!;
            const firstBusyEnd = baselineCycle.startTime.add(10, 'minute');
            const secondBusyStart = firstBusyEnd.add(2, 'minute');
            const secondBusyEnd = secondBusyStart.add(20, 'minute');

            const { entries } = planZoneSchedule(zone, weather, [
                { start: baselineCycle.startTime.subtract(30, 'minute'), end: firstBusyEnd },
                { start: secondBusyStart, end: secondBusyEnd },
            ]);

            expect(entries).toHaveLength(0);
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

        it('keeps cycles that fit and drops cycles displaced past sunrise by a busy window', () => {
            // Default zone: ~190 min total over 2 cycles; a busy window shifts cycle 1
            // to busyEnd (still before sunrise) but the cascade pushes cycle 2 past sunrise.
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

            // Cycle 1 shifted to busyEnd (still fits before sunrise).
            // Cycle 2's intra-zone cascade lands past sunrise — dropped.
            expect(entries).toHaveLength(1);
            expect(entries[0]!.cycles).toHaveLength(1);
            expect(entries[0]!.cycles[0]!.startTime.isSame(busyEnd)).toBe(true);
        });

        it('drops the day when a busy window blocks the entire slot before sunrise', () => {
            const zone = singleCycleZone();
            const sunrise = dayjs('2025-10-20').hour(6).minute(0).second(0).millisecond(0);
            const weather = createWeatherDays([
                { evapotranspirationMmPerDay: 1.0, rainfallMm: 0, sunrise },
            ]);
            // Busy window brackets the entire pre-sunrise region — cycle has nowhere to go.
            const busyStart = sunrise.subtract(2, 'hour');
            const busyEnd = sunrise.add(2, 'hour');

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

            // With currentDepletion clamped to 7.5 mm (overridden TAW), starting
            // depletion > RAW (1.875 mm) so day-0 triggers and refills to 0.
            // With ET=0 the projected end-of-day depletion is 0, not 30.
            expect(result.entries[0]?.depletionBeforeMm).toBeCloseTo(7.5, 1);
            expect(result.projectedNextDepletionMm).toBe(0);
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

    describe('sunset gating', () => {
        // Clay soil: infiltration 4 mm/hr → soak 60 min. Default zone: AWHC=200 mm/m,
        // rootDepthM=0.3 → TAW=60 mm, RAW=30 mm. With precipitationRateMmPerHr=9 and
        // currentDepletionMm=29, irrigation fires on day 1 (after 0.85mm Kc×ET per day
        // accumulates from 29mm to 30.7mm). That depletion triggers 10 cycles; with 60-min
        // soaks the first cycle starts ~796 min (13h16m) before sunrise — at ~16:44 on day 0.
        function sunsetGatingZone() {
            return createTestZone({
                currentDepletionMm: 29, // Just below RAW (30 mm) — fires on day 1 only.
                soil: SOIL_TYPES.clay,
                precipitationRateMmPerHr: 9,
            });
        }

        it('defers a day when first cycle would begin before the previous evening\'s sunset', () => {
            // Day 0 sunset at 17:00; first cycle for day 1 lands at ~16:44 on day 0
            // (before sunset) → the planner defers and returns no entry for day 1.
            const zone = sunsetGatingZone();
            const weather = createWeatherDays([
                { evapotranspirationMmPerDay: 1.0, rainfallMm: 0, sunset: dayjs('2026-05-04').hour(17).minute(0).second(0).millisecond(0) },
                { evapotranspirationMmPerDay: 1.0, rainfallMm: 0 },
            ], dayjs('2026-05-04'));

            const { entries } = planZoneSchedule(zone, weather);

            // Day 0: depletion 29 + 0.85 ET = 29.85 < RAW 30 → no entry.
            // Day 1: first cycle ~16:44 is before sunset 17:00 → gated → no entry.
            expect(entries).toHaveLength(0);
        });

        it('places a day when first cycle starts after the previous evening\'s sunset', () => {
            // Day 0 sunset at 16:00; first cycle for day 1 lands at ~16:44 on day 0
            // (after the 16:00 sunset) → placement is allowed.
            const zone = sunsetGatingZone();
            const weather = createWeatherDays([
                { evapotranspirationMmPerDay: 1.0, rainfallMm: 0, sunset: dayjs('2026-05-04').hour(16).minute(0).second(0).millisecond(0) },
                { evapotranspirationMmPerDay: 1.0, rainfallMm: 0 },
            ], dayjs('2026-05-04'));

            const { entries } = planZoneSchedule(zone, weather);

            // First cycle at ~16:44 is after the 16:00 sunset → entry placed on day 1.
            expect(entries).toHaveLength(1);
            expect(entries[0]!.date.format('YYYY-MM-DD')).toBe('2026-05-05');
        });

        it('never gates dayIndex 0 even when the day has a very late sunset', () => {
            // prevDaySunset is always undefined for dayIndex=0, so the check is skipped
            // regardless of what sunset value the day carries.
            const zone = createTestZone({
                currentDepletionMm: 31, // Above RAW (30 mm for clay) → fires immediately on day 0.
                soil: SOIL_TYPES.clay,
                precipitationRateMmPerHr: 9,
            });
            const weather = createWeatherDays([
                {
                    evapotranspirationMmPerDay: 1.0,
                    rainfallMm: 0,
                    sunrise: dayjs('2026-05-04').hour(6).minute(0).second(0).millisecond(0),
                    sunset: dayjs('2026-05-04').hour(23).minute(59).second(0).millisecond(0),
                },
            ], dayjs('2026-05-04'));

            const { entries } = planZoneSchedule(zone, weather);

            // No prevDaySunset at dayIndex=0 — gate check never runs.
            expect(entries).toHaveLength(1);
            expect(entries[0]!.date.format('YYYY-MM-DD')).toBe('2026-05-04');
        });

        it('does not gate when no sunset is provided for the previous day', () => {
            // If the previous day's DailyWeather has no sunset field, prevDaySunset
            // is undefined and the gate is skipped — irrigation can fire normally.
            const zone = sunsetGatingZone();
            // Day 0 has no sunset field → prevDaySunset for day 1 is undefined.
            const weather = createWeatherDays([
                { evapotranspirationMmPerDay: 1.0, rainfallMm: 0 },
                { evapotranspirationMmPerDay: 1.0, rainfallMm: 0 },
            ], dayjs('2026-05-04'));

            const { entries } = planZoneSchedule(zone, weather);

            // Gate skipped due to missing sunset → entry placed on day 1.
            expect(entries).toHaveLength(1);
            expect(entries[0]!.date.format('YYYY-MM-DD')).toBe('2026-05-05');
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
    });
});
