import { apiFetch } from '@/api/client';

/**
 * Pings `GET /health` purely for reachability — the daemon returns a
 * status snapshot but the client treats the body as opaque. A successful
 * resolution means "API process is up and responding"; any rejection
 * carries an `ApiError` whose `status` (0 for transport, >= 500 for
 * server-side) drives the on-screen failure copy. APP-59.
 */
export function getHealth(): Promise<unknown> {
    return apiFetch<unknown>('/health');
}
