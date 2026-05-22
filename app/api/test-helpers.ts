/**
 * Non-React test helpers shared across api / endpoint / hook tests.
 * Keeping these out of `test-utils.tsx` lets non-React tests (the endpoint
 * suites) import them without dragging in React.
 */

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
