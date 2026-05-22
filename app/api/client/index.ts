/**
 * Typed HTTP client targeting the Irrigo api. Endpoint wrappers in
 * `app/api/endpoints/` call `apiFetch<T>` with a path and an optional
 * `RequestInit`; on a 2xx the parsed JSON is returned, otherwise an
 * `ApiError` is thrown so React Query hooks can surface it via `error`.
 */

const DEFAULT_BASE_URL = 'http://localhost:9753';

/**
 * Resolves the base URL the client targets. Reads `EXPO_PUBLIC_API_BASE_URL`
 * (statically embedded by Expo at bundle time) and falls back to localhost
 * for simulators / type-check / test contexts.
 */
export function getApiBaseUrl(): string {
    const raw = process.env.EXPO_PUBLIC_API_BASE_URL;
    if (typeof raw !== 'string' || raw.length === 0) return DEFAULT_BASE_URL;
    return raw.endsWith('/') ? raw.slice(0, -1) : raw;
}

/**
 * Typed error thrown by `apiFetch` for non-2xx responses (and for transport
 * failures where the server emitted nothing parseable). `code` is the
 * server's `error` field when present (e.g. `'not-found'`, `'busy'`,
 * `'home-assistant'`, `'replan-failed'`); falls back to `'unknown'` when the
 * body wasn't JSON.
 */
export class ApiError extends Error {
    readonly status: number;
    readonly code: string;

    constructor(status: number, code: string, message: string) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
        this.code = code;
    }
}

type ErrorBody = { error?: unknown; message?: unknown };

/**
 * Fetches a JSON endpoint relative to `getApiBaseUrl()`. `path` is joined
 * verbatim (leading `/` recommended). `Content-Type: application/json` is
 * set automatically when a body is present. Non-2xx responses throw an
 * `ApiError` carrying the server's `error` code + `message`.
 *
 * Loading / error conventions
 * ---------------------------
 * - Caller (typically a React Query hook) surfaces `isPending` for first
 *   load and `isFetching` for background refetches. Screens choose between
 *   skeleton (list views) and spinner (detail) accordingly.
 * - On rejection, the typed `ApiError` lets screens discriminate by `status`
 *   and `code`. Recoverable transient failures (5xx) are retried by the
 *   query client; 4xx is final and should surface inline.
 */
export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
    const url = `${getApiBaseUrl()}${path}`;
    const headers = new Headers(init?.headers);
    if (init?.body !== undefined && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
    }
    headers.set('Accept', 'application/json');

    let response: Response;
    try {
        response = await fetch(url, { ...init, headers });
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new ApiError(0, 'network', `network: ${message}`);
    }

    if (response.status === 204) return undefined as T;

    let parsed: unknown = null;
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
        try {
            parsed = await response.json();
        } catch {
            parsed = null;
        }
    }

    if (!response.ok) {
        const body = (parsed ?? {}) as ErrorBody;
        const code = typeof body.error === 'string' ? body.error : 'unknown';
        const message = typeof body.message === 'string' ? body.message : `${response.status} ${response.statusText}`;
        throw new ApiError(response.status, code, message);
    }

    return parsed as T;
}
