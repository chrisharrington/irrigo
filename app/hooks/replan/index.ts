import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import type { ApiError } from '@/api/client';
import { replan } from '@/api/endpoints/replan';
import { keys } from '@/api/query-keys';
import type { ReplanResponse } from '@/api/types/replan';

/**
 * Forces the daemon to re-plan immediately. Used by the CLI scripts and by
 * the operator surface when a schedule change should take effect within
 * seconds rather than at the next 04:00 site-local tick. Invalidates the
 * same set as `useSetSystemEnabled` since a re-plan affects all of them.
 */
export function useReplan(): UseMutationResult<ReplanResponse, ApiError, void> {
    const queryClient = useQueryClient();
    return useMutation<ReplanResponse, ApiError, void>({
        mutationFn: () => replan(),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: keys.system.all() });
            queryClient.invalidateQueries({ queryKey: keys.nextRun.all() });
            queryClient.invalidateQueries({ queryKey: keys.zones.all() });
            queryClient.invalidateQueries({ queryKey: keys.schedules.all() });
        },
    });
}
