import dayjs from 'dayjs';
import { eq } from 'drizzle-orm';
import type { Database } from '@/db';
import { irrigationCycles, scheduleEntries, zones } from '@/db/schema';
import type { Zone } from '@/models';

/**
 * Domain interface for the manual-fire DB writes. The two methods bundle the
 * Drizzle chains that today's inline manual controller does directly. The
 * service tier owns the in-process single-slot lock and the close-timer
 * lifecycle; only the persistence bits live here.
 */
export interface ManualRepository {
    /**
     * Persists one manual fire: inserts a `schedule_entries` row (`source =
     * 'manual'`), inserts a matching `irrigation_cycles` row, and updates
     * `zones.current_depletion_mm` to the clamped post-fire value. Returns
     * the inserted cycle id (or `null` if the schedule-entries insert
     * returned no id — a defensive guard with a warn).
     *
     * @param zone - The zone being fired. Depletion math reads from
     *   `currentDepletionMm`, `irrigationEfficiency`, `precipitationRateMmPerHr`
     *   (with flow-rate / area fallback).
     * @param openedAt - Wall-clock time the relay actually opened. Also
     *   stored as the cycle's `startTime` and `firedAt`.
     * @param closedAt - Wall-clock close time, or `null` for a `run` that
     *   hasn't auto-closed yet.
     * @param durationMin - Planned (or elapsed) duration in minutes; drives
     *   the depletion math.
     */
    writeManualRecord(
        zone: Zone,
        openedAt: Date,
        closedAt: Date | null,
        durationMin: number,
    ): Promise<string | null>;

    /** Stamps the cycle's `closed_at` column after a successful HA close. */
    updateCycleClosedAt(cycleId: string, closedAt: Date): Promise<void>;
}

/**
 * Builds the production `ManualRepository` bound to a Drizzle client. Factory
 * tests pass a partial Drizzle stub cast via `as unknown as Database` and
 * assert the chained INSERT / INSERT / UPDATE payloads.
 */
export function createManualRepository(db: Database): ManualRepository {
    return {
        writeManualRecord: async (zone, openedAt, closedAt, durationMin) => {
            const today = dayjs(openedAt).format('YYYY-MM-DD');
            const precipRate = zone.precipitationRateMmPerHr ?? (60 * (zone.flowRateLPerMin / zone.areaM2));
            const appliedDepth = (durationMin / 60) * precipRate;
            const netDepth = appliedDepth * zone.irrigationEfficiency;
            const depletionBefore = zone.currentDepletionMm;
            const depletionAfter = Math.max(0, depletionBefore - netDepth);

            const insertedEntry = await db
                .insert(scheduleEntries)
                .values([
                    {
                        zoneId: zone.id,
                        scheduleId: null,
                        date: today,
                        appliedDepthMm: roundTo1Decimal(appliedDepth),
                        depletionBeforeMm: roundTo1Decimal(depletionBefore),
                        depletionAfterMm: roundTo1Decimal(depletionAfter),
                        source: 'manual',
                    },
                ])
                .returning({ id: scheduleEntries.id });

            const entryId = (insertedEntry[0] as { id: string } | undefined)?.id;
            if (!entryId) {
                console.warn(`manual: schedule_entries insert returned no id for zone ${zone.id}; skipping cycle row.`);
                return null;
            }

            const insertedCycle = await db
                .insert(irrigationCycles)
                .values([
                    {
                        scheduleEntryId: entryId,
                        startTime: openedAt,
                        durationMin,
                        firedAt: openedAt,
                        closedAt,
                    },
                ])
                .returning({ id: irrigationCycles.id });

            const cycleId = (insertedCycle[0] as { id: string } | undefined)?.id ?? null;

            await db
                .update(zones)
                .set({ currentDepletionMm: depletionAfter })
                .where(eq(zones.id, zone.id));

            return cycleId;
        },

        updateCycleClosedAt: async (cycleId, closedAt) => {
            await db
                .update(irrigationCycles)
                .set({ closedAt })
                .where(eq(irrigationCycles.id, cycleId));
        },
    };
}

function roundTo1Decimal(value: number): number {
    return Math.round(value * 10) / 10;
}
