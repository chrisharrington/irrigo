import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query';
import type { ApiError } from '@/api/client';
import { disableSystem, enableSystem, getSystem } from '@/api/endpoints/system';
import { keys } from '@/api/query-keys';
import type { SystemStateDto } from '@/api/types/system';

/**
 * Returns the master irrigation kill-switch state for the Home screen
 * toggle and "off since …" label.
 */
export function useSystem(): UseQueryResult<SystemStateDto, ApiError> {
    return useQuery<SystemStateDto, ApiError>({
        queryKey: keys.system.state(),
        queryFn: getSystem,
    });
}

type OptimisticContext = { previous: SystemStateDto | undefined };

/**
 * Flips the master irrigation kill switch. The cache update is optimistic:
 * `onMutate` writes the requested state into the system query cache so the
 * master-toggle card flips palette, title, subtitle, and the toggle thumb
 * the moment the user taps. If the server rejects the flip, `onError`
 * rolls the cache back. `onSettled` re-runs the schedule-wide invalidation
 * cascade — system, next-run, zones, schedules — for both success and
 * failure paths, since a failed flip can still leave the cache stale.
 */
export function useSetSystemEnabled(): UseMutationResult<SystemStateDto, ApiError, boolean, OptimisticContext> {
    const queryClient = useQueryClient();
    return useMutation<SystemStateDto, ApiError, boolean, OptimisticContext>({
        mutationFn: (enabled: boolean) => (enabled ? enableSystem() : disableSystem()),
        onMutate: async enabled => {
            // Cancel any in-flight refetch so it can't resolve after the
            // optimistic write and clobber it with stale server data.
            await queryClient.cancelQueries({ queryKey: keys.system.state() });
            const previous = queryClient.getQueryData<SystemStateDto>(keys.system.state());
            queryClient.setQueryData<SystemStateDto>(keys.system.state(), {
                irrigationEnabled: enabled,
                since: new Date().toISOString(),
            });
            return { previous };
        },
        onError: (_err, _enabled, context) => {
            if (context?.previous !== undefined) {
                queryClient.setQueryData(keys.system.state(), context.previous);
            }
        },
        onSettled: () => {
            queryClient.invalidateQueries({ queryKey: keys.system.all() });
            queryClient.invalidateQueries({ queryKey: keys.nextRun.all() });
            queryClient.invalidateQueries({ queryKey: keys.zones.all() });
            queryClient.invalidateQueries({ queryKey: keys.schedules.all() });
        },
    });
}
