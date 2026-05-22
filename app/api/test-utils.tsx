import { QueryClient } from '@tanstack/react-query';
import type { ComponentType, PropsWithChildren } from 'react';
import { ApiProvider } from '@/api/provider';

/**
 * Builds a fresh `<ApiProvider>` wrapper paired with an isolated
 * `QueryClient` so each hook test gets a clean cache and no cross-test
 * leakage. Retries are disabled so a single mocked failure surfaces
 * immediately instead of being retried.
 */
export function buildApiWrapper(): {
    wrapper: ComponentType<PropsWithChildren>;
    client: QueryClient;
} {
    const client = new QueryClient({
        defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false },
        },
    });
    const wrapper = ({ children }: PropsWithChildren) => (
        <ApiProvider client={client}>{children}</ApiProvider>
    );
    return { wrapper, client };
}

/**
 * Builds a `Response` with a JSON body and the right content-type header.
 * Use as the resolved value of a `global.fetch` mock.
 */
export function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
    });
}
