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

/**
 * Flips the master irrigation kill switch. Every flip triggers an
 * immediate re-plan on the api, so this invalidates everything that
 * depends on the schedule: system state, tonight's plan, the zone list,
 * and the schedules list.
 */
export function useSetSystemEnabled(): UseMutationResult<SystemStateDto, ApiError, boolean> {
    const queryClient = useQueryClient();
    return useMutation<SystemStateDto, ApiError, boolean>({
        mutationFn: (enabled: boolean) => (enabled ? enableSystem() : disableSystem()),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: keys.system.all() });
            queryClient.invalidateQueries({ queryKey: keys.tonight.all() });
            queryClient.invalidateQueries({ queryKey: keys.zones.all() });
            queryClient.invalidateQueries({ queryKey: keys.schedules.all() });
        },
    });
}
