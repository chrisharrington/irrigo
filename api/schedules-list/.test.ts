import { beforeEach, describe, expect, it } from 'bun:test';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { irrigationCycles, scheduleEntries, schedules, zones } from '@/db/schema';
import { bootSitesService } from '@/service/sites';
import type { Schedule } from '@/service/schedules';
import {
    formatInLabel,
    formatWhenLabel,
    listSchedules,
    type ScheduleListDb,
} from '.';

dayjs.extend(utc);
dayjs.extend(timezone);

type EntryRow = typeof scheduleEntries.$inferSelect;
type CycleRow = typeof irrigationCycles.$inferSelect;
type ZoneSubset = { id: string; name: string };
type JoinedRow = { entry: EntryRow; cycle: CycleRow | null; zone: ZoneSubset };

const NOW = new Date('2026-05-21T22:00:00.000Z'); // 22:00 UTC, before any night cycles
const SITE_TZ = 'UTC';

function buildSchedule(overrides?: Partial<Schedule>): Schedule {
    return {
        id: 'sched-1',
        siteId: 'site-1',
        slug: 'maintenance',
        name: 'Maintenance',
        isActive: false,
        allowedDays: null,
        allowedTimeWindows: null,
        rootDepthMOverride: null,
        allowableDepletionFractionOverride: null,
        endBySunrise: null,
        skippedNightDate: null,
        createdAt: NOW,
        updatedAt: NOW,
        ...overrides,
    };
}

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
        sunriseAt: null,
        sunsetAt: null,
        createdAt: NOW,
        updatedAt: NOW,
        ...overrides,
    };
}

function buildCycle(overrides?: Partial<CycleRow>): CycleRow {
    return {
        id: 'cycle-1',
        scheduleEntryId: 'entry-1',
        startTime: new Date('2026-05-22T03:00:00.000Z'), // 5h after NOW
        durationMin: 30,
        firedAt: null,
        closedAt: null,
        createdAt: NOW,
        updatedAt: NOW,
        ...overrides,
    };
}

type StubInputs = {
    schedules?: Schedule[];
    nextRunRows?: JoinedRow[];
};

function createStub(inputs?: StubInputs): ScheduleListDb {
    const scheduleRows = inputs?.schedules ?? [];
    const nextRunRows = inputs?.nextRunRows ?? [];

    const db: ScheduleListDb = {
        select: (cols: unknown) => {
            const c = cols as Record<string, unknown>;
            if ('timezone' in c && Object.keys(c).length === 1) {
                return { from: () => Promise.resolve([{ timezone: SITE_TZ }]) } as never;
            }
            if ('schedule' in c && Object.keys(c).length === 1) {
                return {
                    from: () => ({
                        where: () => Promise.resolve(scheduleRows.map(s => ({ schedule: s }))),
                    }),
                } as never;
            }
            if ('entry' in c && 'cycle' in c && 'zone' in c) {
                return {
                    from: () => ({
                        innerJoin: () => ({
                            leftJoin: () => ({
                                where: () => ({
                                    orderBy: () => ({
                                        limit: async () => nextRunRows,
                                    }),
                                }),
                            }),
                        }),
                    }),
                } as never;
            }
            return {} as never;
        },
        update: () => ({ set: () => ({ where: async () => undefined }) }),
        transaction: async (cb) => cb(db as never),
    };
    return db;
}

describe('listSchedules', () => {
    beforeEach(() => {
        bootSitesService({ repo: { loadTimezone: async () => SITE_TZ } });
    });

    it('returns an empty array when no schedules exist', async () => {
        const db = createStub();

        const result = await listSchedules(db, NOW);

        expect(result).toEqual([]);
    });

    it('maps a single inactive schedule with no nextRun or skippedTonight fields', async () => {
        const inactive = buildSchedule({ id: 'sched-X', slug: 'overseeding', name: 'Overseeding', isActive: false });
        const db = createStub({ schedules: [inactive] });

        const result = await listSchedules(db, NOW);

        expect(result).toHaveLength(1);
        const item = result[0]!;
        expect(item).toEqual({
            id: 'sched-X',
            slug: 'overseeding',
            name: 'Overseeding',
            isActive: false,
            allowedDays: null,
            allowedTimeWindows: null,
            rootDepthMOverride: null,
            allowableDepletionFractionOverride: null,
            endBySunrise: null,
        });
        expect(item.nextRun).toBeUndefined();
        expect(item.skippedTonight).toBeUndefined();
    });

    it('passes allowedDays / allowedTimeWindows / overrides / endBySunrise through verbatim', async () => {
        const sched = buildSchedule({
            allowedDays: [3, 5, 7],
            allowedTimeWindows: [
                { start: '00:00', end: '10:00' },
                { start: '19:00', end: '23:59' },
            ],
            rootDepthMOverride: 0.45,
            allowableDepletionFractionOverride: 0.35,
            endBySunrise: true,
        });
        const db = createStub({ schedules: [sched] });

        const [item] = await listSchedules(db, NOW);

        expect(item?.allowedDays).toEqual([3, 5, 7]);
        expect(item?.allowedTimeWindows).toEqual([
            { start: '00:00', end: '10:00' },
            { start: '19:00', end: '23:59' },
        ]);
        expect(item?.rootDepthMOverride).toBe(0.45);
        expect(item?.allowableDepletionFractionOverride).toBe(0.35);
        expect(item?.endBySunrise).toBe(true);
    });

    it('emits nextRun: null on the active schedule when no upcoming entries exist', async () => {
        const active = buildSchedule({ isActive: true });
        const db = createStub({ schedules: [active], nextRunRows: [] });

        const [item] = await listSchedules(db, NOW);

        expect(item?.nextRun).toBeNull();
        expect(item?.skippedTonight).toBe(false);
    });

    it('emits nextRun: null when all returned cycles have already ended (past-only rows)', async () => {
        const active = buildSchedule({ isActive: true });
        const past = new Date('2026-05-21T06:00:00.000Z'); // before NOW (22:00)
        const db = createStub({
            schedules: [active],
            nextRunRows: [{
                entry: buildEntry({ date: '2026-05-21' }),
                cycle: buildCycle({ startTime: past, durationMin: 30 }),
                zone: { id: 'zone-1', name: 'North' },
            }],
        });

        const [item] = await listSchedules(db, NOW);

        expect(item?.nextRun).toBeNull();
    });

    it('builds nextRun on the active schedule when an upcoming night exists', async () => {
        const active = buildSchedule({ id: 'sched-active', isActive: true });
        const start = new Date('2026-05-22T03:00:00.000Z'); // 5h after NOW
        const db = createStub({
            schedules: [active],
            nextRunRows: [
                {
                    entry: buildEntry({ id: 'entry-north', date: '2026-05-22' }),
                    cycle: buildCycle({ id: 'c-north', startTime: start, durationMin: 30 }),
                    zone: { id: 'zone-north', name: 'North' },
                },
                {
                    entry: buildEntry({ id: 'entry-south', date: '2026-05-22' }),
                    cycle: buildCycle({
                        id: 'c-south',
                        startTime: new Date(start.getTime() + 45 * 60_000),
                        durationMin: 30,
                    }),
                    zone: { id: 'zone-south', name: 'South' },
                },
            ],
        });

        const [item] = await listSchedules(db, NOW);

        expect(item?.nextRun).toEqual({
            // NOW is 22:00 on the 21st; start is 03:00 on the 22nd → 5h.
            inLabel: 'in 5 hours',
            // 03:00 UTC on the 22nd, which is the next site-local day from NOW.
            whenLabel: 'Tomorrow at 3:00 AM',
            // North fires first, South second.
            zonesLabel: 'North, South',
        });
    });

    it('only carries nextRun and skippedTonight on the active row when multiple schedules exist', async () => {
        const inactive = buildSchedule({ id: 'sched-other', slug: 'overseeding', name: 'Overseeding', isActive: false });
        const active = buildSchedule({ id: 'sched-active', slug: 'maintenance', isActive: true });
        const db = createStub({
            schedules: [inactive, active],
            nextRunRows: [
                {
                    entry: buildEntry({ date: '2026-05-22' }),
                    cycle: buildCycle({ startTime: new Date('2026-05-22T03:00:00.000Z'), durationMin: 30 }),
                    zone: { id: 'zone-1', name: 'North' },
                },
            ],
        });

        const result = await listSchedules(db, NOW);

        expect(result).toHaveLength(2);
        const inactiveItem = result.find(i => i.id === 'sched-other')!;
        const activeItem = result.find(i => i.id === 'sched-active')!;
        expect(inactiveItem.nextRun).toBeUndefined();
        expect(inactiveItem.skippedTonight).toBeUndefined();
        expect(activeItem.nextRun).not.toBeUndefined();
        expect(activeItem.skippedTonight).toBe(false);
    });

    it('sets skippedTonight: true when the active schedule’s skip marker matches today site-local', async () => {
        // NOW = 2026-05-21 22:00 UTC; site-local YYYY-MM-DD is 2026-05-21.
        const active = buildSchedule({ isActive: true, skippedNightDate: '2026-05-21' });
        const db = createStub({ schedules: [active], nextRunRows: [] });

        const [item] = await listSchedules(db, NOW);

        expect(item?.skippedTonight).toBe(true);
    });

    it('sets skippedTonight: false when the active schedule’s skip marker is stale (not today)', async () => {
        const active = buildSchedule({ isActive: true, skippedNightDate: '2026-05-18' });
        const db = createStub({ schedules: [active], nextRunRows: [] });

        const [item] = await listSchedules(db, NOW);

        expect(item?.skippedTonight).toBe(false);
    });
});

describe('formatInLabel', () => {
    const NOW_MS = NOW.getTime();

    it('returns "Running now" when the start time is already at or past now', () => {
        expect(formatInLabel(NOW_MS, NOW_MS)).toBe('Running now');
        expect(formatInLabel(NOW_MS - 60_000, NOW_MS)).toBe('Running now');
    });

    it('returns minutes for sub-hour deltas', () => {
        expect(formatInLabel(NOW_MS + 12 * 60_000, NOW_MS)).toBe('in 12 min');
        expect(formatInLabel(NOW_MS + 59 * 60_000, NOW_MS)).toBe('in 59 min');
    });

    it('singularises "hour" at exactly 1 hour', () => {
        expect(formatInLabel(NOW_MS + 60 * 60_000, NOW_MS)).toBe('in 1 hour');
    });

    it('returns "in N hours" for sub-day deltas', () => {
        expect(formatInLabel(NOW_MS + 5 * 60 * 60_000, NOW_MS)).toBe('in 5 hours');
        expect(formatInLabel(NOW_MS + 23 * 60 * 60_000, NOW_MS)).toBe('in 23 hours');
    });

    it('returns days for >= 24h deltas', () => {
        expect(formatInLabel(NOW_MS + 24 * 60 * 60_000, NOW_MS)).toBe('in 1 day');
        expect(formatInLabel(NOW_MS + 3 * 24 * 60 * 60_000, NOW_MS)).toBe('in 3 days');
    });
});

describe('formatWhenLabel', () => {
    const now = dayjs('2026-05-21T22:00:00.000Z').tz('UTC');

    it('prefixes "Tonight" when the start is on the same site-local day', () => {
        const start = dayjs('2026-05-21T23:30:00.000Z').tz('UTC');
        expect(formatWhenLabel(start, now)).toBe('Tonight at 11:30 PM');
    });

    it('prefixes "Tomorrow" when the start is on the next site-local day', () => {
        const start = dayjs('2026-05-22T03:00:00.000Z').tz('UTC');
        expect(formatWhenLabel(start, now)).toBe('Tomorrow at 3:00 AM');
    });

    it('prefixes the long-form weekday name for further-out days', () => {
        const start = dayjs('2026-05-24T03:00:00.000Z').tz('UTC');
        // 2026-05-24 is a Sunday.
        expect(formatWhenLabel(start, now)).toBe('Sunday at 3:00 AM');
    });
});

// Keep table imports alive when Drizzle tree-shakes the refs.
void schedules;
void scheduleEntries;
void irrigationCycles;
void zones;
