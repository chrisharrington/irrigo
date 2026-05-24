import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query';
import type { ApiError } from '@/api/client';
import { ackAlert, getAlerts } from '@/api/endpoints/alerts';
import { keys } from '@/api/query-keys';
import type { AckResult, AlertDto } from '@/api/types/alerts';

/**
 * How often the alerts query refetches while a screen consuming it is
 * mounted. 30 s is brisk enough that an alert raised mid-session surfaces
 * within half a minute and slow enough not to hammer the api on a foreground
 * loop. Tanstack-query pauses interval refetches when the app is
 * backgrounded, so this cost is bounded to active sessions.
 */
const ALERTS_POLL_INTERVAL_MS = 30_000;

/**
 * Returns the unacked alert list driving the persistent alert region.
 * Empty array when there's nothing active. Polls /alerts every 30 s so
 * newly-raised failures surface without requiring the user to background
 * and return.
 */
export function useAlerts(): UseQueryResult<AlertDto[], ApiError> {
    return useQuery<AlertDto[], ApiError>({
        queryKey: keys.alerts.list(),
        queryFn: getAlerts,
        refetchInterval: ALERTS_POLL_INTERVAL_MS,
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
