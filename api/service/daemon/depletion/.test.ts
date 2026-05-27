import { describe, expect, it } from 'bun:test';
import { advanceFromObservedWeather, reconcileFromActuationHistory } from '.';

describe('reconcileFromActuationHistory', () => {
    it('subtracts applied depth (on-time × precipitation rate) from previous depletion plus net weather', () => {
        // Two 30-minute cycles at 9 mm/hr = 1 hour total = 9 mm applied.
        // Weather adds 2 mm ET, subtracts 0 mm rain.
        // 22.5 + 2 - 0 - 9 = 15.5 mm
        const result = reconcileFromActuationHistory({
            previousDepletionMm: 22.5,
            weatherDelta: { rainMm: 0, etMm: 2 },
            history: [
                { onAt: new Date('2026-05-24T04:00:00Z'), offAt: new Date('2026-05-24T04:30:00Z') },
                { onAt: new Date('2026-05-24T05:00:00Z'), offAt: new Date('2026-05-24T05:30:00Z') },
            ],
            precipitationRateMmPerHr: 9,
        });

        expect(result.appliedDepthMm).toBeCloseTo(9, 6);
        expect(result.newDepletionMm).toBeCloseTo(15.5, 6);
    });

    it('subtracts rain alongside applied depth', () => {
        // 1 hour at 9 mm/hr = 9 mm applied; 3 mm rain on top.
        // 25 + 1 - 3 - 9 = 14 mm
        const result = reconcileFromActuationHistory({
            previousDepletionMm: 25,
            weatherDelta: { rainMm: 3, etMm: 1 },
            history: [
                { onAt: new Date('2026-05-24T04:00:00Z'), offAt: new Date('2026-05-24T05:00:00Z') },
            ],
            precipitationRateMmPerHr: 9,
        });

        expect(result.newDepletionMm).toBeCloseTo(14, 6);
    });

    it('clamps to zero when rain + applied depth exceed previous depletion + ET', () => {
        // 50 mm rain swamps the deficit. Soil cannot go below 0.
        const result = reconcileFromActuationHistory({
            previousDepletionMm: 5,
            weatherDelta: { rainMm: 50, etMm: 2 },
            history: [],
            precipitationRateMmPerHr: 9,
        });

        expect(result.newDepletionMm).toBe(0);
        expect(result.appliedDepthMm).toBe(0);
    });

    it('treats an empty history as zero applied depth (equivalent to advanceFromObservedWeather)', () => {
        const result = reconcileFromActuationHistory({
            previousDepletionMm: 10,
            weatherDelta: { rainMm: 2, etMm: 4 },
            history: [],
            precipitationRateMmPerHr: 9,
        });

        const weatherOnly = advanceFromObservedWeather({
            previousDepletionMm: 10,
            weatherDelta: { rainMm: 2, etMm: 4 },
        });

        expect(result.newDepletionMm).toBe(weatherOnly);
        expect(result.appliedDepthMm).toBe(0);
    });

    it('skips the actuation term when precipitationRateMmPerHr is undefined', () => {
        // History present but no calibrated precipitation rate → applied = 0.
        const result = reconcileFromActuationHistory({
            previousDepletionMm: 12,
            weatherDelta: { rainMm: 0, etMm: 3 },
            history: [
                { onAt: new Date('2026-05-24T04:00:00Z'), offAt: new Date('2026-05-24T05:00:00Z') },
            ],
            precipitationRateMmPerHr: undefined,
        });

        expect(result.appliedDepthMm).toBe(0);
        expect(result.newDepletionMm).toBe(15);
    });

    it('ignores zero-duration or inverted intervals defensively', () => {
        // A bad row where offAt < onAt should not add negative on-time.
        const result = reconcileFromActuationHistory({
            previousDepletionMm: 10,
            weatherDelta: { rainMm: 0, etMm: 0 },
            history: [
                { onAt: new Date('2026-05-24T05:00:00Z'), offAt: new Date('2026-05-24T05:00:00Z') }, // zero
                { onAt: new Date('2026-05-24T06:00:00Z'), offAt: new Date('2026-05-24T05:30:00Z') }, // inverted
            ],
            precipitationRateMmPerHr: 9,
        });

        expect(result.appliedDepthMm).toBe(0);
        expect(result.newDepletionMm).toBe(10);
    });
});

describe('advanceFromObservedWeather', () => {
    it('grows depletion by net (ET − rain)', () => {
        const result = advanceFromObservedWeather({
            previousDepletionMm: 10,
            weatherDelta: { rainMm: 0, etMm: 4 },
        });

        expect(result).toBe(14);
    });

    it('shrinks depletion when rain exceeds ET', () => {
        const result = advanceFromObservedWeather({
            previousDepletionMm: 10,
            weatherDelta: { rainMm: 5, etMm: 2 },
        });

        expect(result).toBe(7);
    });

    it('clamps to zero when rain swamps the deficit', () => {
        const result = advanceFromObservedWeather({
            previousDepletionMm: 3,
            weatherDelta: { rainMm: 20, etMm: 1 },
        });

        expect(result).toBe(0);
    });

    it('returns the previous value unchanged when weather delta is zero', () => {
        const result = advanceFromObservedWeather({
            previousDepletionMm: 12.4,
            weatherDelta: { rainMm: 0, etMm: 0 },
        });

        expect(result).toBe(12.4);
    });
});
