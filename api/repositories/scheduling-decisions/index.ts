import { lt } from 'drizzle-orm';
import dayjs from 'dayjs';
import type { Database } from '@/db';
import { schedulingDecisions } from '@/db/schema';

/**
 * Default retention window (days) for persisted scheduling decisions. Old rows
 * are pruned on each write so the append-only log stays bounded. Matches the
 * weather-snapshot retention (API-87): a decision can't be reconstructed past
 * the snapshot that drove it, so keeping decisions longer buys nothing.
 * Overridable via the `SCHEDULING_DECISION_RETENTION_DAYS` environment
 * variable. A value of 0 disables pruning. API-88.
 */
export const DEFAULT_SCHEDULING_DECISION_RETENTION_DAYS = 28;

/**
 * Resolves the decision retention window from the
 * `SCHEDULING_DECISION_RETENTION_DAYS` environment variable. Accepts any
 * non-negative integer (0 disables pruning); falls back to
 * `DEFAULT_SCHEDULING_DECISION_RETENTION_DAYS` when unset, non-numeric, or
 * negative. Exported for direct testing.
 */
export function resolveSchedulingDecisionRetentionDays(raw: string | undefined): number {
    if (raw === undefined) return DEFAULT_SCHEDULING_DECISION_RETENTION_DAYS;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_SCHEDULING_DECISION_RETENTION_DAYS;
}

/**
 * A single planning decision to persist. `outcome` / `reason` are the domain
 * `SchedulingOutcome` / `SchedulingDecisionReason` values (stored as text);
 * `date` is the planning day (`YYYY-MM-DD`); `replanAt` is when the replan ran.
 * `weatherSnapshotId` ties the decision to the forecast that drove it — null
 * when the snapshot write failed (best-effort, API-87) or was pruned.
 */
export type RecordSchedulingDecisionInput = {
    /** The zone the decision was made for. */
    zoneId: string;
    /** The active schedule that planned the zone, or null if none. */
    scheduleId: string | null;
    /** The planning day the decision applies to (`YYYY-MM-DD`). */
    date: string;
    /** When the replan that produced this decision ran. */
    replanAt: Date;
    /** `'watered' | 'skipped' | 'deferred'`. */
    outcome: string;
    /** The specific reason for the outcome. */
    reason: string;
    /** Soil depletion before the decision. */
    depletionBeforeMm: number;
    /** Soil depletion after the decision. */
    depletionAfterMm: number;
    /** The trigger threshold (readily-available water) that gated the decision. */
    triggerThresholdMm: number;
    /** The weather snapshot that drove the decision, or null. */
    weatherSnapshotId: string | null;
};

/**
 * Domain interface for the append-only `scheduling_decisions` log.
 */
export interface SchedulingDecisionsRepository {
    /**
     * Appends one decision row, then prunes decisions older than the retention
     * window (measured from `replanAt`). Best-effort by contract — callers
     * treat a rejection as non-fatal so a failed write never stops planning.
     */
    record(input: RecordSchedulingDecisionInput): Promise<void>;
}

/**
 * Builds the production `SchedulingDecisionsRepository` bound to a Drizzle
 * client. `retentionDays` defaults to the resolved
 * `SCHEDULING_DECISION_RETENTION_DAYS` env value; pass an explicit value in
 * tests.
 */
export function createSchedulingDecisionsRepository(
    db: Database,
    retentionDays: number = resolveSchedulingDecisionRetentionDays(process.env.SCHEDULING_DECISION_RETENTION_DAYS),
): SchedulingDecisionsRepository {
    return {
        record: async (input) => {
            await db.insert(schedulingDecisions).values({
                zoneId: input.zoneId,
                scheduleId: input.scheduleId,
                date: input.date,
                replanAt: input.replanAt,
                outcome: input.outcome,
                reason: input.reason,
                depletionBeforeMm: input.depletionBeforeMm,
                depletionAfterMm: input.depletionAfterMm,
                triggerThresholdMm: input.triggerThresholdMm,
                weatherSnapshotId: input.weatherSnapshotId,
            });

            // Prune the append-only log to the retention window. A retention of
            // 0 disables pruning entirely (keep everything).
            if (retentionDays > 0) {
                const cutoff = dayjs(input.replanAt).subtract(retentionDays, 'day').toDate();
                await db.delete(schedulingDecisions).where(lt(schedulingDecisions.replanAt, cutoff));
            }

            console.log(`scheduling-decisions: recorded ${input.outcome}/${input.reason} for zone ${input.zoneId} on ${input.date} (snapshot ${input.weatherSnapshotId ?? 'none'}).`);
        },
    };
}
