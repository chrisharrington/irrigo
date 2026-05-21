/**
 * Generic keyset-pagination cursor codec.
 *
 * Encodes a `(date, id)` tuple as an opaque base64url string the HTTP client
 * round-trips verbatim. Keeping the wire shape opaque means the server is
 * free to change the cursor's internal fields later (add a tertiary sort key,
 * widen the date precision, swap to opaque page tokens, etc.) without
 * breaking clients that have stored old cursors.
 *
 * Used by `api/activity/` and intended for any future endpoint that paginates
 * by `(date DESC, id DESC)`. If a new endpoint needs a different key shape
 * (e.g. `(timestamp, id)`), add a parallel codec rather than overloading
 * this one.
 */

/**
 * Encodes a `(date, id)` pair as an opaque base64url cursor. The internal
 * format is `${date}|${id}` — both fields are URL-safe ASCII, so the `|`
 * separator can't collide with the payload.
 */
export function encodeCursor(date: string, id: string): string {
    return Buffer.from(`${date}|${id}`, 'utf8').toString('base64url');
}

/**
 * Decodes an opaque cursor back into its `(date, id)` parts. Returns `null`
 * when the input is malformed (not base64, missing separator, empty parts)
 * so callers can map that to a 400 without leaking the internal format.
 */
export function decodeCursor(cursor: string): { date: string; id: string } | null {
    if (cursor.length === 0) return null;
    let decoded: string;
    try {
        decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    } catch {
        return null;
    }
    const sep = decoded.indexOf('|');
    if (sep <= 0 || sep === decoded.length - 1) return null;
    const date = decoded.slice(0, sep);
    const id = decoded.slice(sep + 1);
    if (date.length === 0 || id.length === 0) return null;
    return { date, id };
}
