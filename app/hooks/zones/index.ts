import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { ApiError } from '@/api/client';
import { getZones } from '@/api/endpoints';
import { keys } from '@/api/query-keys';
import type { ZoneSummary } from '@/api/types';

/**
 * Returns the zone summary list backing the Home zone-tile list and the
 * Zone detail header. Refetches on the default cadence; mutations that
 * touch zone state (manual zone control, master toggle, schedule changes)
 * invalidate `keys.zones.all()` to drive an immediate refresh.
 */
export function useZones(): UseQueryResult<ZoneSummary[], ApiError> {
    return useQuery<ZoneSummary[], ApiError>({
        queryKey: keys.zones.list(),
        queryFn: getZones,
    });
}
