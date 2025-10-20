import { describe, it, expect } from 'bun:test';
import { findSoilByName } from '.';
import soilData from './lookup.json';

describe('soil', () => {
    it('should have name property for each entry', () => {
        soilData.forEach((soil) => {
            expect(soil.name).toBeDefined();
            expect(typeof soil.name).toBe('string');
            expect(soil.name.length).toBeGreaterThan(0);
        });
    });

    it('should have availableWaterHoldingCapacityMmPerM property for each entry', () => {
        soilData.forEach((soil) => {
            expect(soil.availableWaterHoldingCapacityMmPerM).toBeDefined();
            expect(typeof soil.availableWaterHoldingCapacityMmPerM).toBe('number');
            expect(soil.availableWaterHoldingCapacityMmPerM).toBeGreaterThan(0);
        });
    });

    it('should have infiltrationRateMmPerHr property for each entry', () => {
        soilData.forEach((soil) => {
            expect(soil.infiltrationRateMmPerHr).toBeDefined();
            expect(typeof soil.infiltrationRateMmPerHr).toBe('number');
            expect(soil.infiltrationRateMmPerHr).toBeGreaterThan(0);
        });
    });

    it('should find soil by name', () => {
        const loam = findSoilByName('loam');
        expect(loam).toBeDefined();
        expect(loam.name).toBe('loam');
        expect(loam.label).toBe('Loam');
    });

    it('should throw error for invalid soil name', () => {
        expect(() => findSoilByName('invalid-soil-type')).toThrow('Soil type "invalid-soil-type" not found');
    });
});
