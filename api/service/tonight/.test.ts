import { beforeEach, describe, expect, it } from 'bun:test';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { irrigationCycles, scheduleEntries, zones } from '@/db/schema';
import type { Schedule, SchedulesRepository } from '@/repositories/schedules';
import type { TonightJoinedRow, TonightRepository } from '@/repositories/tonight';
import { bootSchedulesService } from '@/service/schedules';
import { bootSitesService } from '@/service/sites';
import { bootSystemService } from '@/service/system';
import { bootTonightService, getTonightSummary } from '.';

dayjs.extend(utc);
dayjs.extend(timezone);

type EntryRow = typeof scheduleEntries.$inferSelect;
type CycleRow = typeof irrigationCycles.$inferSelect;
type ZoneSubset = { id: string; name: string; slug: string; patch: string };

const NOW = new Date('2026-05-21T01:00:00.000Z');
const SITE_TZ = 'UTC'; // Use UTC so test assertions don't depend on tzdata.

function buildEntry(overrides?: Partial<EntryRow>): EntryRow {
    return {
        id: 'entry-1',
        zoneId: 'zone-1',
        scheduleId: 'sched-1',
        date: '2026-05-21',
        appliedDepthMm: 8.4,
        depletionBeforeMm: 12.0,
        depletionAfterMm: 0.3,
        source: 'scheduled',
        sunriseAt: new Date('2026-05-21T05:30:00.000Z'),
        sunsetAt: new Date('2026-05-20T20:30:00.000Z'),
        createdAt: NOW,
        updatedAt: NOW,
        ...overrides,
    };
}

function buildCycle(overrides?: Partial<CycleRow>): CycleRow {
    return {
        id: 'cycle-1',
        scheduleEntryId: 'entry-1',
        startTime: new Date('2026-05-21T03:00:00.000Z'),
        durationMin: 30,
        firedAt: null,
        closedAt: null,
        createdAt: NOW,
        updatedAt: NOW,
        ...overrides,
    };
}

function buildZone(overrides?: Partial<ZoneSubset>): ZoneSubset {
    return { id: 'zone-1', name: 'North', slug: 'north', patch: 'a', ...overrides };
}

function buildSchedule(skippedNightDate: string | null = null, i: number = 0): Schedule {
    return {
        id: `sched-${i}`,
        siteId: `site-${i}`,
        slug: 'maintenance',
        name: 'Maintenance',
        isActive: true,
        allowedDays: null,
        allowedTimeWindows: null,
        rootDepthMOverride: null,
        allowableDepletionFractionOverride: null,
        endBySunrise: null,
        skippedNightDate,
        createdAt: NOW,
        updatedAt: NOW,
    };
}

function bootSystem(irrigationEnabled: boolean): void {
    bootSystemService({
        repo: {
            findSingleton: async () => ({ irrigationEnabled, since: new Date('2026-05-01T00:00:00.000Z') }),
            upsertSingleton: async () => {},
        },
    });
}

function bootSites(tz: string = SITE_TZ): void {
    bootSitesService({ repo: { loadTimezone: async () => tz } });
}

function bootSchedulesWith(rows: Schedule[]): void {
    const map = new Map<string, Schedule>();
    for (const row of rows) map.set(row.siteId, row);
    const repo: SchedulesRepository = {
        listAll: async () => rows,
        loadActiveBySite: async () => map,
        findBySlug: async () => null,
        enable: async () => null,
        disable: async () => null,
        skipActiveTonight: async () => null,
        resumeActiveTonight: async () => null,
        clearStaleSkipMarkers: async () => undefined,
    };
    bootSchedulesService({ repo });
}

function bootTonightWith(rows: TonightJoinedRow[]): void {
    const repo: TonightRepository = { findEntriesAfter: async () => rows };
    bootTonightService({ repo });
}

describe('getTonightSummary', () => {
    beforeEach(() => {
        bootSites();
        bootSystem(true);
        bootSchedulesWith([buildSchedule(null)]);
        bootTonightWith([]);
    });

    describe('skipped-manual', () => {
        it('returns state: skipped-manual with empty zones when the system kill switch is off', async () => {
            bootSystem(false);

            const result = await getTonightSummary(NOW);

            expect(result.state).toBe('skipped-manual');
            expect(result.zones).toEqual([]);
            expect(result.zoneOrder).toEqual([]);
            expect(result.totalCycles).toBe(0);
            expect(result.startTime).toBeNull();
            expect(result.endsAt).toBeNull();
        });

        it(`returns state: skipped-manual when the active schedule's skippedNightDate matches today`, async () => {
            bootSchedulesWith([buildSchedule('2026-05-21')]);

            const result = await getTonightSummary(NOW);

            expect(result.state).toBe('skipped-manual');
            expect(result.zones).toEqual([]);
        });

        it('returns state: skipped-manual when one of several active schedules matches today (multi-site)', async () => {
            bootSchedulesWith([buildSchedule(null, 0), buildSchedule('2026-05-21', 1)]);

            const result = await getTonightSummary(NOW);

            expect(result.state).toBe('skipped-manual');
        });
    });

    describe('idle', () => {
        it('returns state: idle when the repository returns no rows', async () => {
            bootTonightWith([]);

            const result = await getTonightSummary(NOW);

            expect(result.state).toBe('idle');
            expect(result.zones).toEqual([]);
            expect(result.totalCycles).toBe(0);
            expect(result.startTime).toBeNull();
        });

        it('returns state: idle when entries exist but all cycles have already ended', async () => {
            const past = new Date('2026-05-20T03:00:00.000Z');
            bootTonightWith([{
                entry: buildEntry({ date: '2026-05-20' }),
                cycle: buildCycle({ startTime: past, durationMin: 5 }),
                zone: buildZone(),
            }]);

            const result = await getTonightSummary(NOW);

            expect(result.state).toBe('idle');
        });

        it('returns state: idle when entries exist but all cycle joins are null (planner has not materialised cycles yet)', async () => {
            bootTonightWith([{
                entry: buildEntry(),
                cycle: null,
                zone: buildZone(),
            }]);

            const result = await getTonightSummary(NOW);

            expect(result.state).toBe('idle');
        });
    });

    describe('scheduled', () => {
        it('builds the DTO with state: scheduled when entries exist and no cycle has fired', async () => {
            const start = new Date('2026-05-21T03:00:00.000Z');
            bootTonightWith([{
                entry: buildEntry(),
                cycle: buildCycle({ startTime: start, durationMin: 30 }),
                zone: buildZone(),
            }]);

            const result = await getTonightSummary(NOW);

            expect(result.state).toBe('scheduled');
            expect(result.startTime).toBe(start.toISOString());
            expect(result.endsAt).toBe(new Date(start.getTime() + 30 * 60_000).toISOString());
            expect(result.totalCycles).toBe(1);
            expect(result.zones).toHaveLength(1);
            expect(result.zones[0]?.name).toBe('North');
            expect(result.zones[0]?.patch).toBe('a');
            expect(result.zones[0]?.cycles[0]?.start).toBe('03:00');
            expect(result.zones[0]?.cycles[0]?.durMin).toBe(30);
            expect(result.zoneOrder).toEqual(['North']);
        });

        it('formats sunset and sunrise as HH:MM site-local and uses them for axis bounds', async () => {
            bootTonightWith([{
                entry: buildEntry({
                    sunriseAt: new Date('2026-05-21T05:30:00.000Z'),
                    sunsetAt: new Date('2026-05-20T20:30:00.000Z'),
                }),
                cycle: buildCycle({ startTime: new Date('2026-05-21T03:00:00.000Z'), durationMin: 30 }),
                zone: buildZone(),
            }]);

            const result = await getTonightSummary(NOW);

            expect(result.sunset).toBe('20:30');
            expect(result.sunrise).toBe('05:30');
            expect(result.axisStart).toBe('20:30');
            expect(result.axisEnd).toBe('05:30');
        });

        it('falls back axisStart/axisEnd to HH:MM of startTime/endsAt when sunrise/sunset columns are null', async () => {
            const start = new Date('2026-05-21T03:00:00.000Z');
            bootTonightWith([{
                entry: buildEntry({ sunriseAt: null, sunsetAt: null }),
                cycle: buildCycle({ startTime: start, durationMin: 30 }),
                zone: buildZone(),
            }]);

            const result = await getTonightSummary(NOW);

            expect(result.sunset).toBeNull();
            expect(result.sunrise).toBeNull();
            expect(result.axisStart).toBe('03:00');
            expect(result.axisEnd).toBe('03:30');
        });
    });

    describe('firing', () => {
        it('returns state: firing when at least one tonight cycle is open (firedAt set, closedAt null)', async () => {
            bootTonightWith([{
                entry: buildEntry(),
                cycle: buildCycle({
                    startTime: new Date('2026-05-21T00:50:00.000Z'),
                    durationMin: 30,
                    firedAt: new Date('2026-05-21T00:50:00.000Z'),
                    closedAt: null,
                }),
                zone: buildZone(),
            }]);

            const result = await getTonightSummary(NOW);

            expect(result.state).toBe('firing');
        });

        it('returns state: scheduled (not firing) when every fired cycle has closedAt — already done', async () => {
            bootTonightWith([
                {
                    entry: buildEntry(),
                    cycle: buildCycle({
                        id: 'cycle-done',
                        startTime: new Date('2026-05-21T00:30:00.000Z'),
                        durationMin: 10,
                        firedAt: new Date('2026-05-21T00:30:00.000Z'),
                        closedAt: new Date('2026-05-21T00:40:00.000Z'),
                    }),
                    zone: buildZone(),
                },
                {
                    entry: buildEntry(),
                    cycle: buildCycle({ id: 'cycle-future', startTime: new Date('2026-05-21T03:00:00.000Z'), durationMin: 30 }),
                    zone: buildZone(),
                },
            ]);

            const result = await getTonightSummary(NOW);

            expect(result.state).toBe('scheduled');
        });
    });

    describe('multi-zone grouping', () => {
        it(`orders zoneOrder by each zone's first-fire time and sums totalCycles`, async () => {
            bootTonightWith([
                {
                    entry: buildEntry({ id: 'entry-south' }),
                    cycle: buildCycle({
                        id: 'c-south',
                        startTime: new Date('2026-05-21T02:00:00.000Z'),
                        durationMin: 10,
                    }),
                    zone: buildZone({ id: 'zone-south', name: 'South', slug: 'south', patch: 'b' }),
                },
                {
                    entry: buildEntry({ id: 'entry-north' }),
                    cycle: buildCycle({
                        id: 'c-north-1',
                        startTime: new Date('2026-05-21T03:00:00.000Z'),
                        durationMin: 10,
                    }),
                    zone: buildZone({ id: 'zone-north', name: 'North', slug: 'north', patch: 'a' }),
                },
                {
                    entry: buildEntry({ id: 'entry-north' }),
                    cycle: buildCycle({
                        id: 'c-north-2',
                        startTime: new Date('2026-05-21T03:30:00.000Z'),
                        durationMin: 10,
                    }),
                    zone: buildZone({ id: 'zone-north', name: 'North', slug: 'north', patch: 'a' }),
                },
            ]);

            const result = await getTonightSummary(NOW);

            expect(result.zoneOrder).toEqual(['South', 'North']);
            expect(result.totalCycles).toBe(3);
            expect(result.zones.find(z => z.name === 'North')?.cycles).toHaveLength(2);
            expect(result.zones.find(z => z.name === 'South')?.cycles).toHaveLength(1);
        });
    });

    describe('tonight-date selection', () => {
        it(`picks tomorrow when today's cycles have all ended (after-daytime case)`, async () => {
            bootTonightWith([
                {
                    entry: buildEntry({ id: 'entry-today', date: '2026-05-21' }),
                    cycle: buildCycle({
                        id: 'c-today',
                        startTime: new Date('2026-05-20T18:00:00.000Z'),
                        durationMin: 30,
                    }),
                    zone: buildZone(),
                },
                {
                    entry: buildEntry({ id: 'entry-tomorrow', date: '2026-05-22' }),
                    cycle: buildCycle({
                        id: 'c-tomorrow',
                        startTime: new Date('2026-05-22T03:00:00.000Z'),
                        durationMin: 30,
                    }),
                    zone: buildZone(),
                },
            ]);

            const result = await getTonightSummary(NOW);

            expect(result.state).toBe('scheduled');
            expect(result.startTime).toBe(new Date('2026-05-22T03:00:00.000Z').toISOString());
        });

        it(`picks today when a mid-night cycle's end is still in the future`, async () => {
            bootTonightWith([
                {
                    entry: buildEntry({ id: 'entry-tonight', date: '2026-05-21' }),
                    cycle: buildCycle({
                        id: 'c-active',
                        startTime: new Date('2026-05-21T00:30:00.000Z'),
                        durationMin: 60,
                        firedAt: new Date('2026-05-21T00:30:00.000Z'),
                    }),
                    zone: buildZone(),
                },
            ]);

            const result = await getTonightSummary(NOW);

            expect(result.state).toBe('firing');
            expect(result.startTime).toBe(new Date('2026-05-21T00:30:00.000Z').toISOString());
        });
    });

    describe('repository contract', () => {
        it('forwards the site-local today date to the repository', async () => {
            const cutoffs: string[] = [];
            bootTonightService({
                repo: {
                    findEntriesAfter: async (cutoff) => {
                        cutoffs.push(cutoff);
                        return [];
                    },
                },
            });

            await getTonightSummary(NOW);

            expect(cutoffs).toEqual(['2026-05-21']);
        });
    });
});

// Keep schema imports alive when Drizzle tree-shakes the table refs.
void scheduleEntries;
void irrigationCycles;
void zones;
