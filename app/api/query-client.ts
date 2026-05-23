import { QueryClient } from '@tanstack/react-query';
import { ApiError } from '@/api/client';

/**
 * Production-default options for the app's `QueryClient`.
 *
 * - `staleTime: 30s` keeps the UI from refetching every screen mount while
 *   still picking up server-side changes within a sensible window.
 * - `refetchOnWindowFocus: false` — RN doesn't fire window focus the way the
 *   browser does; the existing background refetch on reconnect is enough.
 * - `retry` only retries 5xx ApiErrors (up to 2 times). 4xx errors are final
 *   so the user sees a meaningful inline state rather than spinning twice
 *   before giving up.
 */
export function createQueryClient(): QueryClient {
    return new QueryClient({
        defaultOptions: {
            queries: {
                staleTime: 30_000,
                refetchOnWindowFocus: false,
                retry: (failureCount, error) => {
                    if (!(error instanceof ApiError)) return failureCount < 2;
                    if (error.status >= 500) return failureCount < 2;
                    return false;
                },
            },
            mutations: {
                retry: false,
            },
        },
    });
}
