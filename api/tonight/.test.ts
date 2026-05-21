import { describe, expect, it } from 'bun:test';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { irrigationCycles, scheduleEntries, sites, zones } from '@/db/schema';
import { getTonightSummary, type TonightDb } from '.';

dayjs.extend(utc);
dayjs.extend(timezone);

type EntryRow = typeof scheduleEntries.$inferSelect;
type CycleRow = typeof irrigationCycles.$inferSelect;
type ZoneSubset = { id: string; name: string; slug: string; patch: string };
type JoinedRow = { entry: EntryRow; cycle: CycleRow | null; zone: ZoneSubset };

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

type StubInputs = {
    irrigationEnabled?: boolean;
    skippedNightDateOnActive?: string | null;
    rows?: JoinedRow[];
    activeSchedules?: number; // number of active schedules to surface (0 → none)
};

function createStub(inputs?: StubInputs): TonightDb {
    const irrigationEnabled = inputs?.irrigationEnabled ?? true;
    const skippedNightDate = inputs?.skippedNightDateOnActive ?? null;
    const rows = inputs?.rows ?? [];
    const activeSchedulesCount = inputs?.activeSchedules ?? 1;

    const since = new Date('2026-05-01T00:00:00.000Z');

    const db: TonightDb = {
        select: (cols: unknown) => {
            const c = cols as Record<string, unknown>;
            // SiteTimezoneDb shape: single 'timezone' column.
            if ('timezone' in c && Object.keys(c).length === 1) {
                return { from: () => Promise.resolve([{ timezone: SITE_TZ }]) } as never;
            }
            // SystemStateReaderDb shape: irrigationEnabled + since.
            if ('irrigationEnabled' in c && 'since' in c) {
                return {
                    from: () => ({
                        where: () => ({
                            limit: async () => [{ irrigationEnabled, since }],
                        }),
                    }),
                } as never;
            }
            // ScheduleManagerDb shape: single 'schedule' column.
            if ('schedule' in c && Object.keys(c).length === 1) {
                const scheduleRows: Array<{ schedule: Record<string, unknown> }> = [];
                for (let i = 0; i < activeSchedulesCount; i++) {
                    scheduleRows.push({
                        schedule: {
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
                        },
                    });
                }
                return {
                    from: () => ({
                        where: () => Promise.resolve(scheduleRows),
                    }),
                } as never;
            }
            // TonightLoaderDb shape: entry + cycle + zone columns.
            if ('entry' in c && 'cycle' in c && 'zone' in c) {
                return {
                    from: () => ({
                        innerJoin: () => ({
                            leftJoin: () => ({
                                where: () => ({
                                    orderBy: () => ({
                                        limit: async () => rows,
                                    }),
                                }),
                            }),
                        }),
                    }),
                } as never;
            }
            return {} as never;
        },
    } as TonightDb;
    return db;
}

describe('getTonightSummary', () => {
    describe('skipped-manual', () => {
        it('returns state: skipped-manual with empty zones when the system kill switch is off', async () => {
            const db = createStub({ irrigationEnabled: false });

            const result = await getTonightSummary(db, NOW);

            expect(result.state).toBe('skipped-manual');
            expect(result.zones).toEqual([]);
            expect(result.zoneOrder).toEqual([]);
            expect(result.totalCycles).toBe(0);
            expect(result.startTime).toBeNull();
            expect(result.endsAt).toBeNull();
        });

        it(`returns state: skipped-manual when the active schedule's skippedNightDate matches today`, async () => {
            const db = createStub({ skippedNightDateOnActive: '2026-05-21' });

            const result = await getTonightSummary(db, NOW);

            expect(result.state).toBe('skipped-manual');
            expect(result.zones).toEqual([]);
        });
    });

    describe('idle', () => {
        it('returns state: idle when no schedule_entries qualify as tonight', async () => {
            const db = createStub({ rows: [] });

            const result = await getTonightSummary(db, NOW);

            expect(result.state).toBe('idle');
            expect(result.zones).toEqual([]);
            expect(result.totalCycles).toBe(0);
            expect(result.startTime).toBeNull();
        });

        it('returns state: idle when entries exist but all cycles have already ended', async () => {
            const past = new Date('2026-05-20T03:00:00.000Z'); // way before NOW
            const db = createStub({
                rows: [{
                    entry: buildEntry({ date: '2026-05-20' }),
                    cycle: buildCycle({ startTime: past, durationMin: 5 }),
                    zone: buildZone(),
                }],
            });

            const result = await getTonightSummary(db, NOW);

            expect(result.state).toBe('idle');
        });
    });

    describe('scheduled', () => {
        it('builds the DTO with state: scheduled when entries exist and no cycle has fired', async () => {
            const start = new Date('2026-05-21T03:00:00.000Z'); // 2h after NOW
            const db = createStub({
                rows: [{
                    entry: buildEntry(),
                    cycle: buildCycle({ startTime: start, durationMin: 30 }),
                    zone: buildZone(),
                }],
            });

            const result = await getTonightSummary(db, NOW);

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
            const db = createStub({
                rows: [{
                    entry: buildEntry({
                        sunriseAt: new Date('2026-05-21T05:30:00.000Z'),
                        sunsetAt: new Date('2026-05-20T20:30:00.000Z'),
                    }),
                    cycle: buildCycle({ startTime: new Date('2026-05-21T03:00:00.000Z'), durationMin: 30 }),
                    zone: buildZone(),
                }],
            });

            const result = await getTonightSummary(db, NOW);

            expect(result.sunset).toBe('20:30');
            expect(result.sunrise).toBe('05:30');
            expect(result.axisStart).toBe('20:30');
            expect(result.axisEnd).toBe('05:30');
        });

        it('falls back axisStart/axisEnd to startTime/endsAt-shaped HH:MM when sunrise/sunset columns are null', async () => {
            const start = new Date('2026-05-21T03:00:00.000Z');
            const db = createStub({
                rows: [{
                    entry: buildEntry({ sunriseAt: null, sunsetAt: null }),
                    cycle: buildCycle({ startTime: start, durationMin: 30 }),
                    zone: buildZone(),
                }],
            });

            const result = await getTonightSummary(db, NOW);

            expect(result.sunset).toBeNull();
            expect(result.sunrise).toBeNull();
            expect(result.axisStart).toBe('03:00');
            expect(result.axisEnd).toBe('03:30');
        });
    });

    describe('firing', () => {
        it('returns state: firing when at least one tonight cycle is open (firedAt set, closedAt null)', async () => {
            const db = createStub({
                rows: [{
                    entry: buildEntry(),
                    cycle: buildCycle({
                        startTime: new Date('2026-05-21T00:50:00.000Z'),
                        durationMin: 30,
                        firedAt: new Date('2026-05-21T00:50:00.000Z'),
                        closedAt: null,
                    }),
                    zone: buildZone(),
                }],
            });

            const result = await getTonightSummary(db, NOW);

            expect(result.state).toBe('firing');
        });

        it('returns state: scheduled (not firing) when a cycle has closedAt — already done', async () => {
            const db = createStub({
                rows: [
                    // First cycle: done (firedAt + closedAt set, both in the past).
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
                    // Second cycle: still in the future, not fired.
                    {
                        entry: buildEntry(),
                        cycle: buildCycle({ id: 'cycle-future', startTime: new Date('2026-05-21T03:00:00.000Z'), durationMin: 30 }),
                        zone: buildZone(),
                    },
                ],
            });

            const result = await getTonightSummary(db, NOW);

            expect(result.state).toBe('scheduled');
        });
    });

    describe('multi-zone grouping', () => {
        it('orders zoneOrder by each zone’s first-fire time and sums totalCycles', async () => {
            const db = createStub({
                rows: [
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
                ],
            });

            const result = await getTonightSummary(db, NOW);

            // South fires first (02:00 < 03:00), so it leads zoneOrder.
            expect(result.zoneOrder).toEqual(['South', 'North']);
            expect(result.totalCycles).toBe(3);
            expect(result.zones.find(z => z.name === 'North')?.cycles).toHaveLength(2);
            expect(result.zones.find(z => z.name === 'South')?.cycles).toHaveLength(1);
        });
    });

    describe('tonight-date selection', () => {
        it('picks tomorrow when today’s cycles have all ended (after-daytime case)', async () => {
            // NOW is 01:00 UTC on the 21st. Place today's cycle in the past
            // (already done) and tomorrow's cycle in the future. We expect the
            // tomorrow date's cycles to surface.
            const db = createStub({
                rows: [
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
                ],
            });

            const result = await getTonightSummary(db, NOW);

            expect(result.state).toBe('scheduled');
            expect(result.startTime).toBe(new Date('2026-05-22T03:00:00.000Z').toISOString());
        });

        it('picks today when a mid-night cycle’s end is still in the future', async () => {
            // NOW is 01:00 UTC on the 21st. A cycle that started at 00:30 with
            // 60min duration ends at 01:30 — still future. Should pick today.
            const db = createStub({
                rows: [
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
                ],
            });

            const result = await getTonightSummary(db, NOW);

            expect(result.state).toBe('firing');
            expect(result.startTime).toBe(new Date('2026-05-21T00:30:00.000Z').toISOString());
        });
    });
});

// Keep imports alive when Drizzle tree-shakes the table refs.
void scheduleEntries;
void irrigationCycles;
void zones;
void sites;
