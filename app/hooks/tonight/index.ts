import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { ApiError } from '@/api/client';
import { getTonight } from '@/api/endpoints/tonight';
import { keys } from '@/api/query-keys';
import type { TonightDto } from '@/api/types/tonight';

/**
 * Returns the next-run summary for the Home hero card and CycleStrip. The
 * api re-evaluates on every request, so refetching is the only way to pick
 * up state changes after a master toggle or zone fire.
 */
export function useTonight(): UseQueryResult<TonightDto, ApiError> {
    return useQuery<TonightDto, ApiError>({
        queryKey: keys.tonight.summary(),
        queryFn: getTonight,
    });
}
