import type { ApiError } from '@/api/client';
import type { ZoneSummary } from '@/api/types/zones';
import { useZones } from '@/hooks/zones';

/**
 * Result of `useZone`. `zone` is `undefined` while the underlying list is
 * loading **or** when the supplied `slug` doesn't match any returned zone —
 * the caller distinguishes those by inspecting `isPending`.
 */
export type UseZoneResult = {
    zone: ZoneSummary | undefined;
    isPending: boolean;
    isError: boolean;
    error: ApiError | null;
};

/**
 * Derived hook that returns a single zone by slug. Composes `useZones()` so
 * the underlying query is shared with the Home zone-tile list (no extra
 * network call when navigating Home → Zone detail).
 *
 * @param slug - The zone slug from the route param. `undefined` returns the
 *   underlying query's loading/error state with `zone: undefined`.
 */
export function useZone(slug: string | undefined): UseZoneResult {
    const zones = useZones();
    const zone = zones.data?.find(z => z.slug === slug);
    return {
        zone,
        isPending: zones.isPending,
        isError: zones.isError,
        error: zones.error ?? null,
    };
}
