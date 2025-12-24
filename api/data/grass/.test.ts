import { describe, expect, it } from 'bun:test';
import { findGrassByName, grassData } from '.';

describe('grass', () => {
    it('should have at least one growth stage for each entry', () => {
        grassData.forEach(grass => {
            expect(grass.growthStages).toBeDefined();
            expect(Array.isArray(grass.growthStages)).toBe(true);
            expect(grass.growthStages.length).toBeGreaterThan(0);
        });
    });

    it('should have monthRanges for every growth stage', () => {
        grassData.forEach(grass => {
            grass.growthStages.forEach(stage => {
                expect(stage.monthRanges).toBeDefined();
                expect(Array.isArray(stage.monthRanges)).toBe(true);
                expect(stage.monthRanges.length).toBeGreaterThan(0);
            });
        });
    });

    it('should have cropCoefficient for every growth stage', () => {
        grassData.forEach(grass => {
            grass.growthStages.forEach(stage => {
                expect(stage.cropCoefficient).toBeDefined();
                expect(typeof stage.cropCoefficient).toBe('number');
                expect(stage.cropCoefficient).toBeGreaterThan(0);
                expect(stage.cropCoefficient).toBeLessThanOrEqual(1.0);
            });
        });
    });

    it('should find kentucky-bluegrass', () => {
        const grass = findGrassByName('kentucky-bluegrass');
        expect(grass).toBeDefined();
        expect(grass.name).toBe('kentucky-bluegrass');
        expect(grass.label).toBe('Kentucky Bluegrass');
        expect(grass.growthStages.length).toBe(5);
    });

    it('should find perennial-ryegrass', () => {
        const grass = findGrassByName('perennial-ryegrass');
        expect(grass).toBeDefined();
        expect(grass.name).toBe('perennial-ryegrass');
        expect(grass.label).toBe('Perennial Ryegrass');
        expect(grass.growthStages.length).toBe(5);
    });

    it('should find tall-fescue', () => {
        const grass = findGrassByName('tall-fescue');
        expect(grass).toBeDefined();
        expect(grass.name).toBe('tall-fescue');
        expect(grass.label).toBe('Tall Fescue');
        expect(grass.growthStages.length).toBe(5);
    });

    it('should find bermudagrass', () => {
        const grass = findGrassByName('bermudagrass');
        expect(grass).toBeDefined();
        expect(grass.name).toBe('bermudagrass');
        expect(grass.label).toBe('Bermudagrass');
        expect(grass.growthStages.length).toBe(6);
    });

    it('should find st-augustine', () => {
        const grass = findGrassByName('st-augustine');
        expect(grass).toBeDefined();
        expect(grass.name).toBe('st-augustine');
        expect(grass.label).toBe('St. Augustine');
        expect(grass.growthStages.length).toBe(5);
    });

    it('should find zoysiagrass', () => {
        const grass = findGrassByName('zoysiagrass');
        expect(grass).toBeDefined();
        expect(grass.name).toBe('zoysiagrass');
        expect(grass.label).toBe('Zoysiagrass');
        expect(grass.growthStages.length).toBe(5);
    });

    it('should find buffalo-grass', () => {
        const grass = findGrassByName('buffalo-grass');
        expect(grass).toBeDefined();
        expect(grass.name).toBe('buffalo-grass');
        expect(grass.label).toBe('Buffalo Grass');
        expect(grass.growthStages.length).toBe(4);
    });

    it('should find fine-fescue-mix', () => {
        const grass = findGrassByName('fine-fescue-mix');
        expect(grass).toBeDefined();
        expect(grass.name).toBe('fine-fescue-mix');
        expect(grass.label).toBe('Fine Fescue Mix');
        expect(grass.growthStages.length).toBe(5);
    });

    it('should throw error for invalid grass name', () => {
        expect(() => findGrassByName('invalid-grass-type')).toThrow('Grass type "invalid-grass-type" not found');
    });
});
