import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import type { ApiError } from '@/api/client';
import { getHealth } from '@/api/endpoints/health';
import { keys } from '@/api/query-keys';

/**
 * Runs the app-load reachability probe against `GET /health`. The body is
 * opaque to the client (`unknown`) — only success vs failure matters. The
 * `ReachabilityGate` consumes this hook to decide between rendering the
 * app shell (success) and the `ErrorView` (failure). APP-59.
 */
export function useHealth(): UseQueryResult<unknown, ApiError> {
    return useQuery<unknown, ApiError>({
        queryKey: keys.health.status(),
        queryFn: getHealth,
    });
}
