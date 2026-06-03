import type { ZoneSeed } from '@/data/seeds';

/**
 * Computes the initial `currentDepletionMm` value for a zone being seeded.
 * Returns the explicit seed value when provided (including 0); otherwise
 * defaults to the zone's MAD (maximum allowable depletion) so a freshly
 * seeded zone triggers irrigation on the very first replan rather than
 * waiting for ET to accumulate from scratch.
 *
 * MAD = rootDepthM × soilAwcMmPerM × allowableDepletionFraction
 */
export function computeInitialDepletionMm(
    zone: Pick<ZoneSeed, 'rootDepthM' | 'allowableDepletionFraction' | 'currentDepletionMm'>,
    soilAwcMmPerM: number,
): number {
    if (zone.currentDepletionMm !== undefined) return zone.currentDepletionMm;
    return zone.rootDepthM * soilAwcMmPerM * zone.allowableDepletionFraction;
}
