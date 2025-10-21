import dayjs, { type Dayjs } from 'dayjs';
import type { Zone, GrassType, SoilType } from '../models';

/**
 * Creates a test zone with sensible defaults that can be overridden.
 *
 * @param overrides - Partial Zone object to override defaults
 * @returns Complete Zone object for testing
 */
export function createTestZone(overrides?: Partial<Zone>): Zone {
    return {
        id: 'test-zone-001',
        name: 'Test Zone',
        grassType: {
            name: 'Kentucky Bluegrass',
            cropCoefficient: 0.85,
        },
        soil: {
            name: 'Loam',
            availableWaterHoldingCapacityMmPerM: 150,
            infiltrationRateMmPerHr: 25,
        },
        rootDepthM: 0.3,
        allowableDepletionFraction: 0.5,
        irrigationEfficiency: 0.8,
        flowRateLPerMin: 15,
        areaM2: 100,
        precipitationRateMmPerHr: 9,
        currentDepletionMm: 0,
        isEnabled: true,
        location: {
            lat: 51.0447,
            lon: -114.0719,
        },
        ...overrides,
    };
}

/**
 * Creates a grass type object.
 *
 * @param name - Grass type name
 * @param cropCoefficient - Crop coefficient (0-1.0)
 * @returns GrassType object
 */
export function createGrassType(name: string, cropCoefficient: number): GrassType {
    return { name, cropCoefficient };
}

/**
 * Creates a soil type object.
 *
 * @param name - Soil type name
 * @param availableWaterHoldingCapacityMmPerM - AWHC in mm/m
 * @param infiltrationRateMmPerHr - Infiltration rate in mm/hr
 * @returns SoilType object
 */
export function createSoilType(
    name: string,
    availableWaterHoldingCapacityMmPerM: number,
    infiltrationRateMmPerHr: number
): SoilType {
    return { name, availableWaterHoldingCapacityMmPerM, infiltrationRateMmPerHr };
}

/**
 * Predefined grass types for common test scenarios.
 */
export const GRASS_TYPES = {
    dormant: createGrassType('Dormant Grass', 0.4),
    lowWater: createGrassType('Buffalo Grass', 0.6),
    medium: createGrassType('Kentucky Bluegrass', 0.85),
    highWater: createGrassType('Perennial Ryegrass', 1.0),
};

/**
 * Predefined soil types for common test scenarios.
 */
export const SOIL_TYPES = {
    sand: createSoilType('Sand', 75, 50),
    sandyLoam: createSoilType('Sandy Loam', 125, 30),
    loam: createSoilType('Loam', 150, 25),
    clayLoam: createSoilType('Clay Loam', 175, 13),
    clay: createSoilType('Clay', 200, 4),
};
