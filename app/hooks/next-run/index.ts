import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { ApiError } from '@/api/client';
import { getNextRun } from '@/api/endpoints/next-run';
import { keys } from '@/api/query-keys';
import type { NextRunDto } from '@/api/types/next-run';

/**
 * Returns the next-run summary for the Home hero card and CycleStrip. The
 * api re-evaluates on every request, so refetching is the only way to pick
 * up state changes after a master toggle or zone fire.
 */
export function useNextRun(): UseQueryResult<NextRunDto, ApiError> {
    return useQuery<NextRunDto, ApiError>({
        queryKey: keys.nextRun.summary(),
        queryFn: getNextRun,
    });
}
