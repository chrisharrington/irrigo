import { describe, it, expect } from 'bun:test';
import { computeInitialDepletionMm } from './depletion';

describe('computeInitialDepletionMm', () => {
    it('returns MAD when currentDepletionMm is not set', () => {
        // MAD = 0.3 * 165 * 0.5 = 24.75  (clay-loam AWC = 165 mm/m)
        const result = computeInitialDepletionMm(
            { rootDepthM: 0.3, allowableDepletionFraction: 0.5, currentDepletionMm: undefined },
            165,
        );
        expect(result).toBeCloseTo(24.75);
    });

    it('returns 0 when currentDepletionMm is explicitly 0', () => {
        const result = computeInitialDepletionMm(
            { rootDepthM: 0.3, allowableDepletionFraction: 0.5, currentDepletionMm: 0 },
            165,
        );
        expect(result).toBe(0);
    });

    it('returns the explicit value when currentDepletionMm is set to a positive number', () => {
        const result = computeInitialDepletionMm(
            { rootDepthM: 0.3, allowableDepletionFraction: 0.5, currentDepletionMm: 12.5 },
            165,
        );
        expect(result).toBe(12.5);
    });
});
