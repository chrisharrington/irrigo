import { paletteForZone, zonePaletteForTests } from '.';

describe('paletteForZone', () => {
    it('exposes six rotation slots.', () => {
        expect(zonePaletteForTests()).toHaveLength(6);
    });

    it('returns the accent green for the first zone.', () => {
        expect(paletteForZone(0).color).toBe('#5ece48');
        expect(paletteForZone(0).glow).toBe('rgba(94, 206, 72, 0.4)');
    });

    it('returns the info blue for the second zone.', () => {
        expect(paletteForZone(1).color).toBe('#7CD4FB');
    });

    it('returns the warn amber for the third zone.', () => {
        expect(paletteForZone(2).color).toBe('#FFBE6B');
    });

    it('loops past the sixth slot back to the first.', () => {
        expect(paletteForZone(6)).toEqual(paletteForZone(0));
        expect(paletteForZone(7)).toEqual(paletteForZone(1));
        expect(paletteForZone(12)).toEqual(paletteForZone(0));
    });

    it('falls back to slot 0 for a negative index.', () => {
        expect(paletteForZone(-1)).toEqual(paletteForZone(0));
    });

    it('falls back to slot 0 for NaN.', () => {
        expect(paletteForZone(Number.NaN)).toEqual(paletteForZone(0));
    });

    it('falls back to slot 0 for a non-integer index.', () => {
        expect(paletteForZone(1.5)).toEqual(paletteForZone(0));
    });
});
