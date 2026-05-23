import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query';
import type { ApiError } from '@/api/client';
import { ackAlert, getAlerts } from '@/api/endpoints/alerts';
import { keys } from '@/api/query-keys';
import type { AckResult, AlertDto } from '@/api/types/alerts';

/**
 * Returns the unacked alert list driving the persistent alert region.
 * Empty array when there's nothing active.
 */
export function useAlerts(): UseQueryResult<AlertDto[], ApiError> {
    return useQuery<AlertDto[], ApiError>({
        queryKey: keys.alerts.list(),
        queryFn: getAlerts,
    });
}

/**
 * Dismisses an alert from the UI without resolving the underlying
 * condition. Idempotent on the server side — re-acking already-acked
 * alerts returns `'already-acked'` rather than failing.
 */
export function useAckAlert(): UseMutationResult<AckResult, ApiError, string> {
    const queryClient = useQueryClient();
    return useMutation<AckResult, ApiError, string>({
        mutationFn: (alertId: string) => ackAlert(alertId),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: keys.alerts.all() });
        },
    });
}
