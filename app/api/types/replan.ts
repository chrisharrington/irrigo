/**
 * Reply shape returned by `POST /replan`. `lastRePlanAt` is the post-
 * re-plan timestamp from the daemon's status (ISO-8601 UTC; `null` only
 * during the bootstrap window before a plan has run).
 */
export type ReplanResponse = {
    status: 'replanned';
    lastRePlanAt: string | null;
};
