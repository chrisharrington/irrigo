import type dayjs from 'dayjs';
import type { SchedulingDecision, SchedulingDecisionReason, SchedulingOutcome } from '@/models/decision';
import { roundTo1Decimal } from './util';

/**
 * Builds a `SchedulingDecision`, rounding the depletion/threshold values to one
 * decimal for clean persisted output (matching the entry's `appliedDepthMm` /
 * `depletionBeforeMm` precision). API-88.
 */
export function buildDecision(
    date: dayjs.Dayjs,
    outcome: SchedulingOutcome,
    reason: SchedulingDecisionReason,
    depletionBeforeMm: number,
    depletionAfterMm: number,
    triggerThresholdMm: number,
): SchedulingDecision {
    return {
        date,
        outcome,
        reason,
        depletionBeforeMm: roundTo1Decimal(depletionBeforeMm),
        depletionAfterMm: roundTo1Decimal(depletionAfterMm),
        triggerThresholdMm: roundTo1Decimal(triggerThresholdMm),
    };
}
