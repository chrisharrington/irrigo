import type dayjs from 'dayjs';

/**
 * The three terminal outcomes the planner can reach for a given night.
 *
 *  - `watered`  — cycles were placed and will fire tonight.
 *  - `skipped`  — the planner deliberately chose not to water (no need, rain
 *    coming, day not allowed, operator skip-marker). Depletion carries forward.
 *  - `deferred` — the planner *wanted* to water but couldn't place the cycles
 *    (no sunrise anchor, overnight window too short, no cycle count fit, all
 *    cycles already past). Depletion carries forward and is reconsidered next
 *    replan.
 */
export type SchedulingOutcome = 'watered' | 'skipped' | 'deferred';

/**
 * The specific reason behind a `SchedulingOutcome`. One-to-one with the
 * planner's decision branches so a retrospective can name exactly why a night
 * went the way it did.
 */
export type SchedulingDecisionReason =
    // skipped
    | 'below-threshold'
    | 'rain-forecast'
    | 'day-not-allowed'
    | 'operator-skip'
    // deferred
    | 'no-anchor'
    | 'window-too-short'
    | 'no-cycle-fit'
    | 'past-window'
    // watered
    | 'full-refill'
    | 'partial-refill';

/**
 * The planner's decision for a single zone on a single night (day 0 of the
 * planning horizon). Captures the outcome, its reason, the depletion before
 * and after, and the trigger threshold that gated the decision — everything
 * needed (alongside the weather snapshot) to reconstruct why the night went
 * the way it did. The daemon persists this into `scheduling_decisions`. API-88.
 */
export type SchedulingDecision = {
    /** The planning day the decision applies to (day 0 of the horizon). */
    date: dayjs.Dayjs;
    /** The terminal outcome. */
    outcome: SchedulingOutcome;
    /** The specific reason for the outcome. */
    reason: SchedulingDecisionReason;
    /** Soil depletion (mm) at the moment the decision was made. */
    depletionBeforeMm: number;
    /** Soil depletion (mm) after the decision (== before, except on `watered`). */
    depletionAfterMm: number;
    /** The trigger threshold (readily-available water, mm) that gated the decision. */
    triggerThresholdMm: number;
};
