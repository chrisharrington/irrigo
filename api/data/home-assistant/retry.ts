/**
 * Error thrown when Home Assistant returns a non-2xx HTTP response. Carries
 * the status and statusText so the retry layer can decide whether the failure
 * is transient (5xx) or permanent (4xx).
 */
export class HttpResponseError extends Error {
    readonly status: number;
    readonly statusText: string;

    constructor(status: number, statusText: string, message: string) {
        super(message);
        this.name = 'HttpResponseError';
        this.status = status;
        this.statusText = statusText;
    }
}

/**
 * Configuration for a single `retry` call.
 */
export type RetryOptions = {
    /** Total number of attempts, including the first. Must be >= 1. */
    maxAttempts: number;

    /** Base delay used by the exponential schedule, in milliseconds. */
    baseMs: number;

    /** Logical operation name (e.g. `turn_on`) — used for log context only. */
    operation: string;

    /** HA entity ID being acted on — used for log context only. */
    entityId: string;
};

/**
 * Returns the delay before the next attempt as `baseMs * 2^attempt`.
 *
 * @param attempt - Zero-indexed attempt number (0 = delay before the second try).
 * @param baseMs - Base delay in milliseconds.
 * @returns Computed delay in milliseconds.
 */
export function computeBackoffMs(attempt: number, baseMs: number): number {
    return baseMs * 2 ** attempt;
}

/**
 * Runs `fn` with retries on transient failures. A 4xx `HttpResponseError`
 * surfaces immediately; a 5xx `HttpResponseError` or any other thrown value
 * (network errors, timeouts) is retried with exponential backoff up to
 * `opts.maxAttempts` total tries. After exhaustion, the last underlying error
 * is thrown.
 *
 * @param fn - Async callable to invoke.
 * @param opts - Retry budget, base delay, and log context.
 * @returns Resolved value from `fn` on success.
 * @throws The original error from `fn` after exhausting retries or on a permanent failure.
 */
export async function retry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
    const { maxAttempts, baseMs, operation, entityId } = opts;
    let lastError: unknown;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
            return await fn();
        } catch (err) {
            lastError = err;

            if (!isTransient(err)) {
                console.warn(`home-assistant: ${operation} on ${entityId} failed permanently on attempt ${attempt + 1}/${maxAttempts}; not retrying.`, err);
                throw err;
            }

            const isLastAttempt = attempt === maxAttempts - 1;
            if (isLastAttempt) {
                console.error(`home-assistant: ${operation} on ${entityId} exhausted ${maxAttempts} attempts.`, err);
                throw err;
            }

            const delayMs = computeBackoffMs(attempt, baseMs);
            const message = err instanceof Error ? err.message : String(err);
            console.warn(`home-assistant: ${operation} on ${entityId} attempt ${attempt + 1}/${maxAttempts} failed (${message}); retrying in ${delayMs}ms.`);
            await sleep(delayMs);
        }
    }

    throw lastError;
}

function isTransient(err: unknown): boolean {
    if (err instanceof HttpResponseError) return err.status >= 500;
    return true;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
