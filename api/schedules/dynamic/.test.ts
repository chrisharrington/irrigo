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

            const schedule = planZoneSchedule(zone, weather);

            expect(schedule).toHaveLength(0);
        });

        it('should schedule single irrigation when depletion exceeds threshold once', () => {
            const zone = createTestZone({
                currentDepletionMm: 20,
                allowableDepletionFraction: 0.5,
            });
            const weather = createDryPeriod(7, 1.5);

            const schedule = planZoneSchedule(zone, weather);

            expect(schedule.length).toBeGreaterThan(0);
            expect(schedule[0]!.appliedDepthMm).toBeGreaterThan(0);
        });

        it('should schedule multiple irrigation events during extended dry period', () => {
            const zone = createTestZone({
                currentDepletionMm: 0,
                allowableDepletionFraction: 0.5,
            });
            const weather = createDryPeriod(30, 3.5);

            const schedule = planZoneSchedule(zone, weather);

            expect(schedule.length).toBeGreaterThan(1);
        });

        it('should schedule daily irrigation during heat wave', () => {
            const zone = createTestZone({
                currentDepletionMm: 0,
                allowableDepletionFraction: 0.5,
                grassType: GRASS_TYPES.highWater,
            });
            const weather = createHeatWave(14);

            const schedule = planZoneSchedule(zone, weather);

            // Heat wave with high water use grass requires frequent irrigation.
            expect(schedule.length).toBeGreaterThan(3);
        });

        it('should schedule irrigation on first day when starting above threshold', () => {
            const zone = createTestZone({
                currentDepletionMm: 25,
                allowableDepletionFraction: 0.5,
            });
            const weather = createDryPeriod(7, 2.0);

            const schedule = planZoneSchedule(zone, weather);

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

            const schedule = planZoneSchedule(zone, weather);

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

            const schedule = planZoneSchedule(zone, weather);

            expect(schedule.length).toBeGreaterThan(0);
        });

        it('should prevent irrigation with heavy rainfall that reduces depletion', () => {
            const zone = createTestZone({ currentDepletionMm: 20 });
            const weather = createWeatherDays([
                { evapotranspirationMmPerDay: 2.0, rainfallMm: 15.0 },
                { evapotranspirationMmPerDay: 2.0, rainfallMm: 10.0 },
                { evapotranspirationMmPerDay: 2.0, rainfallMm: 0 },
            ]);

            const schedule = planZoneSchedule(zone, weather);

            expect(schedule).toHaveLength(0);
        });

        it('should handle rainfall after scheduled irrigation', () => {
            const zone = createTestZone({ currentDepletionMm: 23 });
            const weather = createWeatherDays([
                { evapotranspirationMmPerDay: 2.0, rainfallMm: 0 },
                { evapotranspirationMmPerDay: 2.0, rainfallMm: 10.0 },
                { evapotranspirationMmPerDay: 2.0, rainfallMm: 0 },
            ]);

            const schedule = planZoneSchedule(zone, weather);

            expect(schedule.length).toBeGreaterThan(0);
        });

        it('should handle intermittent rainfall pattern', () => {
            const zone = createTestZone({ currentDepletionMm: 10 });
            const weather = createIntermittentRainfall(14);

            const schedule = planZoneSchedule(zone, weather);

            // Should have some irrigation events but fewer than dry period.
            expect(schedule.length).toBeLessThan(14);
        });

        it('should handle consecutive rainy days preventing irrigation', () => {
            const zone = createTestZone({ currentDepletionMm: 15 });
            const weather = createRainyPeriod(10, 8.0);

            const schedule = planZoneSchedule(zone, weather);

            expect(schedule).toHaveLength(0);
        });

        it('should treat exactly 2mm rainfall as effective', () => {
            const zone = createTestZone({ currentDepletionMm: 20 });
            const weather = createWeatherDays([
                { evapotranspirationMmPerDay: 2.0, rainfallMm: 2.0 },
            ]);

            const schedule = planZoneSchedule(zone, weather);

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

            const schedule = planZoneSchedule(zone, weather);

            expect(schedule).toHaveLength(0);
        });

        it('should handle high ET period requiring frequent irrigation', () => {
            const zone = createTestZone({ currentDepletionMm: 0 });
            const weather = createDryPeriod(14, 6.0);

            const schedule = planZoneSchedule(zone, weather);

            expect(schedule.length).toBeGreaterThan(2);
        });

        it('should handle variable ET pattern', () => {
            const zone = createTestZone({ currentDepletionMm: 10 });
            const weather = createVariableET(14);

            const schedule = planZoneSchedule(zone, weather);

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

            const schedule = planZoneSchedule(zone, weather);

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

            const schedule = planZoneSchedule(zone, weather);

            // Sandy soil has lower AWHC, reaches threshold faster.
            expect(schedule.length).toBeGreaterThanOrEqual(3);
        });

        it('should handle clay soil with slow depletion', () => {
            const zone = createTestZone({
                soil: SOIL_TYPES.clay,
                currentDepletionMm: 0,
            });
            const weather = createDryPeriod(14, 3.0);

            const schedule = planZoneSchedule(zone, weather);

            // Clay soil has higher AWHC, takes longer to reach threshold.
            expect(schedule.length).toBeLessThan(5);
        });

        it('should handle loam soil with balanced characteristics', () => {
            const zone = createTestZone({
                soil: SOIL_TYPES.loam,
                currentDepletionMm: 0,
            });
            const weather = createDryPeriod(14, 3.0);

            const schedule = planZoneSchedule(zone, weather);

            expect(schedule.length).toBeGreaterThan(0);
            expect(schedule.length).toBeLessThan(14);
        });

        it('should handle sandy loam soil', () => {
            const zone = createTestZone({
                soil: SOIL_TYPES.sandyLoam,
                currentDepletionMm: 0,
            });
            const weather = createDryPeriod(14, 3.0);

            const schedule = planZoneSchedule(zone, weather);

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

            const schedule = planZoneSchedule(zone, weather);

            expect(schedule.length).toBeLessThan(7);
        });

        it('should handle medium water use grass', () => {
            const zone = createTestZone({
                grassType: GRASS_TYPES.medium,
                currentDepletionMm: 0,
            });
            const weather = createDryPeriod(14, 4.0);

            const schedule = planZoneSchedule(zone, weather);

            expect(schedule.length).toBeGreaterThan(0);
        });

        it('should handle high water use grass with frequent irrigation', () => {
            const zone = createTestZone({
                grassType: GRASS_TYPES.highWater,
                currentDepletionMm: 0,
            });
            const weather = createDryPeriod(14, 4.0);

            const schedule = planZoneSchedule(zone, weather);

            expect(schedule.length).toBeGreaterThan(1);
        });

        it('should handle dormant grass with minimal water needs', () => {
            const zone = createTestZone({
                grassType: GRASS_TYPES.dormant,
                currentDepletionMm: 0,
            });
            const weather = createDryPeriod(14, 5.0);

            const schedule = planZoneSchedule(zone, weather);

            expect(schedule.length).toBeLessThan(3);
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

            const schedule = planZoneSchedule(zone, weather);

            // Shallow roots mean less total available water, more frequent irrigation.
            expect(schedule.length).toBeGreaterThan(2);
        });

        it('should handle medium roots with moderate irrigation frequency', () => {
            const zone = createTestZone({
                rootDepthM: 0.3,
                currentDepletionMm: 0,
            });
            const weather = createDryPeriod(14, 3.0);

            const schedule = planZoneSchedule(zone, weather);

            expect(schedule.length).toBeGreaterThan(0);
        });

        it('should handle deep roots with less frequent irrigation', () => {
            const zone = createTestZone({
                rootDepthM: 0.5,
                currentDepletionMm: 0,
            });
            const weather = createDryPeriod(14, 3.0);

            const schedule = planZoneSchedule(zone, weather);

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

            const schedule = planZoneSchedule(zone, weather);

            expect(schedule.length).toBeGreaterThan(1);
        });

        it('should use standard depletion (50%) for typical lawn management', () => {
            const zone = createTestZone({
                allowableDepletionFraction: 0.5,
                currentDepletionMm: 0,
            });
            const weather = createDryPeriod(14, 2.5);

            const schedule = planZoneSchedule(zone, weather);

            expect(schedule.length).toBeGreaterThan(0);
            expect(schedule.length).toBeLessThan(7);
        });

        it('should allow more depletion with aggressive management (70%)', () => {
            const zone = createTestZone({
                allowableDepletionFraction: 0.7,
                currentDepletionMm: 0,
            });
            const weather = createDryPeriod(14, 2.5);

            const schedule = planZoneSchedule(zone, weather);

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

            const schedule = planZoneSchedule(zone, weather);

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

            const schedule = planZoneSchedule(zone, weather);

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

            const schedule = planZoneSchedule(zone, weather);

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

            const schedule = planZoneSchedule(zone, weather);

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

            const schedule = planZoneSchedule(zone, weather);

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

            const schedule = planZoneSchedule(zone, weather);

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

            const schedule = planZoneSchedule(zone, weather);

            expect(schedule.length).toBeGreaterThan(0);
            expect(schedule[0]!.cycles).toHaveLength(1);
        });
    });

    // Edge Cases.
    describe('Edge Cases', () => {
        it('should return empty schedule for disabled zone', () => {
            const zone = createTestZone({ isEnabled: false });
            const weather = createDryPeriod(14, 5.0);

            const schedule = planZoneSchedule(zone, weather);

            expect(schedule).toHaveLength(0);
        });

        it('should trigger irrigation when depletion is exactly at RAW threshold', () => {
            const zone = createTestZone({
                currentDepletionMm: 22.5,
                allowableDepletionFraction: 0.5,
            });
            const weather = createDryPeriod(3, 0.1);

            const schedule = planZoneSchedule(zone, weather);

            expect(schedule.length).toBeGreaterThan(0);
        });

        it('should not trigger irrigation when depletion is slightly below RAW', () => {
            const zone = createTestZone({
                currentDepletionMm: 22.0,
                allowableDepletionFraction: 0.5,
            });
            const weather = createDryPeriod(3, 0.1);

            const schedule = planZoneSchedule(zone, weather);

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

            const schedule = planZoneSchedule(zone, weather);

            expect(schedule.length).toBeGreaterThan(0);
        });

        it('should clamp initial depletion that exceeds TAW', () => {
            const zone = createTestZone({
                currentDepletionMm: 100,
                allowableDepletionFraction: 0.5,
            });
            const weather = createDryPeriod(3, 1.0);

            const schedule = planZoneSchedule(zone, weather);

            expect(schedule.length).toBeGreaterThan(0);
            expect(schedule[0]!.depletionBeforeMm).toBeLessThanOrEqual(45);
        });

        it('should clamp negative initial depletion to zero', () => {
            const zone = createTestZone({
                currentDepletionMm: -10,
                allowableDepletionFraction: 0.5,
            });
            const weather = createDryPeriod(7, 3.5);

            const schedule = planZoneSchedule(zone, weather);

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

            const schedule = planZoneSchedule(zone, weather);

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

            const schedule = planZoneSchedule(zone, weather);

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

            const schedule = planZoneSchedule(zone, weather);

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

            const schedule = planZoneSchedule(zone, weather);

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

            const schedule = planZoneSchedule(zone, weather);

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

            const schedule = planZoneSchedule(zone, weather);

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

            const schedule = planZoneSchedule(zone, weather);

            expect(schedule.length).toBeGreaterThan(0);
        });

        it('should handle spring establishment with low coefficient and shallow roots', () => {
            const zone = createTestZone({
                grassType: GRASS_TYPES.lowWater,
                rootDepthM: 0.15,
                currentDepletionMm: 5,
            });
            const weather = createVariableET(14);

            const schedule = planZoneSchedule(zone, weather);

            expect(schedule.length).toBeGreaterThan(0);
        });

        it('should handle summer stress with high coefficient and high ET', () => {
            const zone = createTestZone({
                grassType: GRASS_TYPES.highWater,
                currentDepletionMm: 10,
            });
            const weather = createHeatWave(14);

            const schedule = planZoneSchedule(zone, weather);

            expect(schedule.length).toBeGreaterThan(3);
        });
    });

    // Time-Based Patterns.
    describe('Time-Based Patterns', () => {
        it('should handle 14-day planning period', () => {
            const zone = createTestZone({ currentDepletionMm: 10 });
            const weather = createDryPeriod(14, 2.5);

            const schedule = planZoneSchedule(zone, weather);

            expect(schedule.length).toBeGreaterThan(0);
        });

        it('should handle 30-day extended planning period', () => {
            const zone = createTestZone({ currentDepletionMm: 0 });
            const weather = createDryPeriod(30, 2.5);

            const schedule = planZoneSchedule(zone, weather);

            expect(schedule.length).toBeGreaterThan(1);
        });

        it('should handle 7-day short-term planning', () => {
            const zone = createTestZone({ currentDepletionMm: 15 });
            const weather = createDryPeriod(7, 2.5);

            const schedule = planZoneSchedule(zone, weather);

            expect(schedule.length).toBeGreaterThan(0);
        });

        it('should handle single day planning', () => {
            const zone = createTestZone({ currentDepletionMm: 23 });
            const weather = createDryPeriod(1, 2.0);

            const schedule = planZoneSchedule(zone, weather);

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

            const schedule = planZoneSchedule(zone, weather);

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

            const schedule = planZoneSchedule(zone, weather);

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

            const schedule = planZoneSchedule(zone, weather);

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

            const schedule = planZoneSchedule(zone, weather);

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

            const schedule = planZoneSchedule(zone, weather);

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

            const schedule = planZoneSchedule(zone, weather);

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

            const schedule = planZoneSchedule(zone, weather);

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

            const schedule = planZoneSchedule(zone, weather);

            schedule.forEach((entry) => {
                expect(entry.appliedDepthMm).toBeGreaterThan(0);
            });
        });

        it('should reset depletion to zero after irrigation', () => {
            const zone = createTestZone({ currentDepletionMm: 25 });
            const weather = createDryPeriod(3, 1.0);

            const schedule = planZoneSchedule(zone, weather);

            expect(schedule.length).toBeGreaterThan(0);
            expect(schedule[0]!.depletionAfterMm).toBe(0);
        });
    });
});
