import config from '@/tailwind.config';

const colors = config.theme.extend.colors;

/**
 * One slot in the zone palette: the solid colour used for the lane and
 * cycle pulse plus the matching outer-glow rgba.
 */
export type ZonePaletteSlot = {
    color: string;
    glow: string;
};

/**
 * Six-slot rotation derived from the design system's accent palette. Each
 * slot pairs a solid colour with a matching outer-glow rgba so the
 * embedded CycleStrip pulses read as the same hue with a softer
 * surround. Order matches the source's North / South / East assignment
 * (accent green / info blue / warn amber) and extends with rose / water /
 * moon for sites with more than three zones.
 */
const PALETTE: ReadonlyArray<ZonePaletteSlot> = [
    { color: colors.accent, glow: colors['accent-border'] },
    { color: colors.info, glow: colors['info-border'] },
    { color: colors.warn, glow: colors['warn-border'] },
    { color: colors['rose-500'], glow: 'rgba(255, 107, 123, 0.4)' },
    { color: colors['water-500'], glow: 'rgba(124, 212, 251, 0.4)' },
    { color: colors['moon-500'], glow: 'rgba(216, 198, 144, 0.4)' },
];

/**
 * Returns the palette slot for a given zone position. Loops past the
 * sixth slot via modular arithmetic. Falls back to slot 0 for negative,
 * fractional, or NaN inputs — guards against accidental misuse without
 * throwing in a render path.
 */
export function paletteForZone(index: number): ZonePaletteSlot {
    if (!Number.isInteger(index) || index < 0) {
        return PALETTE[0] as ZonePaletteSlot;
    }
    return PALETTE[index % PALETTE.length] as ZonePaletteSlot;
}

/** Exposed for tests that want to assert palette length and content. */
export function zonePaletteForTests(): ReadonlyArray<ZonePaletteSlot> {
    return PALETTE;
}
