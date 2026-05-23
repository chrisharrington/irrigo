import { useInfiniteQuery, type UseInfiniteQueryResult } from '@tanstack/react-query';
import type { ApiError } from '@/api/client';
import { getActivity } from '@/api/endpoints/activity';
import { keys } from '@/api/query-keys';
import type { ActivityListResult } from '@/api/types/activity';

export type UseActivityParams = {
    zoneId?: string;
};

/**
 * Returns the chronological activity feed. Optionally filtered by `zoneId`
 * for Zone detail's "Recent runs" tab. Uses `useInfiniteQuery` so screens
 * can call `fetchNextPage` to paginate through the cursor-based API.
 */
export function useActivity(params: UseActivityParams = {}): UseInfiniteQueryResult<ActivityListResult, ApiError> {
    return useInfiniteQuery<ActivityListResult, ApiError, ActivityListResult, ReadonlyArray<unknown>, string | undefined>({
        queryKey: keys.activity.list({ ...(params.zoneId !== undefined ? { zoneId: params.zoneId } : {}) }),
        queryFn: ({ pageParam }) => getActivity({
            ...(params.zoneId !== undefined ? { zoneId: params.zoneId } : {}),
            ...(pageParam !== undefined ? { cursor: pageParam } : {}),
        }),
        initialPageParam: undefined,
        getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    });
}
