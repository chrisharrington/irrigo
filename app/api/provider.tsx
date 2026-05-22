import { useMemo, type PropsWithChildren } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createQueryClient } from '@/api/query-client';

export type ApiProviderProps = PropsWithChildren<{
    /**
     * Optional `QueryClient` override. Production passes nothing and a fresh
     * client is constructed once; tests pass an isolated client per-test so
     * caches don't bleed across cases.
     */
    client?: QueryClient;
}>;

/**
 * Wraps the app tree with the TanStack Query `QueryClientProvider`. Sits
 * outermost in `_layout.tsx` so every screen — including the splash-gated
 * subtree under `<FontLoader>` — has access to query/mutation hooks.
 */
export function ApiProvider({ client, children }: ApiProviderProps) {
    const resolved = useMemo(() => client ?? createQueryClient(), [client]);
    return <QueryClientProvider client={resolved}>{children}</QueryClientProvider>;
}
