import { useEffect, useState } from 'react';

/**
 * Returns the current instant, refreshed on a fixed interval so relative-time
 * labels (e.g. a zone tile's "Last ran ...") stay accurate while the screen
 * stays mounted instead of drifting against a `new Date()` frozen at mount.
 * APP-87.
 *
 * @param intervalMs - How often to refresh, in milliseconds. Defaults to one
 *   minute — fine-grained enough to cross hour/midnight boundaries promptly,
 *   cheap enough to ignore. Pass `null` to freeze at the initial value (no
 *   timer); callers that supply their own deterministic `now` use this so they
 *   don't spin up a real interval.
 * @returns The current `Date`, replaced with a fresh instance each tick.
 */
export function useNow(intervalMs: number | null = 60_000): Date {
    const [now, setNow] = useState<Date>(() => new Date());

    useEffect(() => {
        if (intervalMs === null) return;
        const id = setInterval(() => setNow(new Date()), intervalMs);
        return () => clearInterval(id);
    }, [intervalMs]);

    return now;
}
