import { describe, it, expect } from 'bun:test';
import { irrigationCycles, scheduleEntries, zones } from '@/db/schema';
import type { Clock, TimerHandle } from '@/daemon/runtime';
import type { Zone } from '@/models';
import type { NotificationContext, NotificationEvent, Notifier } from '@/notifications';
import {
    BusyError,
    createManualController,
    MAX_RUN_DURATION_MIN,
    type ManualControllerDb,
} from '.';

type RecordedNotification = { event: NotificationEvent; context: NotificationContext | undefined };

function recordingNotifier(): { notifier: Notifier; calls: RecordedNotification[] } {
    const calls: RecordedNotification[] = [];
    const notifier: Notifier = async (event, context) => {
        calls.push({ event, context });
    };
    return { notifier, calls };
}

type ScheduledTimer = { handle: number; fireAt: number; cb: () => void };

function createFakeClock(initial: Date) {
    let currentMs = initial.getTime();
    let nextHandle = 1;
    const timers = new Map<number, ScheduledTimer>();

    const clock: Clock = {
        now: () => new Date(currentMs),
        setTimeout(cb, ms) {
            const handle = nextHandle++;
            timers.set(handle, { handle, fireAt: currentMs + ms, cb });
            return handle as TimerHandle;
        },
        clearTimeout(h) {
            timers.delete(h as number);
        },
    };

    async function flushMicrotasks(): Promise<void> {
        for (let i = 0; i < 50; i += 1) await new Promise<void>(resolve => setImmediate(resolve));
    }

    async function advanceTo(target: Date): Promise<void> {
        const targetMs = target.getTime();
        while (true) {
            let earliest: ScheduledTimer | undefined;
            for (const t of timers.values()) {
                if (t.fireAt > targetMs) continue;
                if (!earliest || t.fireAt < earliest.fireAt) earliest = t;
            }
            if (!earliest) break;
            timers.delete(earliest.handle);
            currentMs = earliest.fireAt;
            earliest.cb();
            await flushMicrotasks();
        }
        currentMs = targetMs;
    }

    return { clock, advanceTo, getPendingCount: () => timers.size };
}

type InsertCall = { table: unknown; rows: ReadonlyArray<Record<string, unknown>> };
type UpdateCall = { table: unknown; values: Record<string, unknown> };

function createDbStub() {
    const inserts: InsertCall[] = [];
    const updates: UpdateCall[] = [];
    let nextEntryId = 1;
    let nextCycleId = 1;

    const db: ManualControllerDb = {
        insert(table) {
            return {
                values(rows) {
                    return {
                        returning() {
                            inserts.push({ table, rows });
                            if (table === scheduleEntries) {
                                return Promise.resolve(rows.map(() => ({ id: `entry-${nextEntryId++}` })));
                            }
                            if (table === irrigationCycles) {
                                return Promise.resolve(rows.map(() => ({ id: `cycle-${nextCycleId++}` })));
                            }
                            return Promise.resolve([]);
                        },
                    };
                },
            };
        },
        update(table) {
            return {
                set(values) {
                    return {
                        where() {
                            updates.push({ table, values });
                            return Promise.resolve(undefined);
                        },
                    };
                },
            };
        },
    };

    return { db, inserts, updates };
}

function buildZone(overrides?: Partial<Zone>): Zone {
    return {
        id: 'zone-001',
        name: 'Front Lawn',
        grassType: { name: 'Kentucky Bluegrass', cropCoefficient: 0.85 },
        soil: { name: 'Loam', availableWaterHoldingCapacityMmPerM: 150, infiltrationRateMmPerHr: 25 },
        rootDepthM: 0.3,
        allowableDepletionFraction: 0.5,
        irrigationEfficiency: 0.8,
        flowRateLPerMin: 15,
        areaM2: 100,
        precipitationRateMmPerHr: 9,
        currentDepletionMm: 12,
        siteTimezone: 'America/Edmonton',
        isEnabled: true,
        homeAssistantEntityId: 'switch.zone_001',
        ...overrides,
    };
}

const NOW = new Date('2026-05-04T15:00:00.000Z');

describe('manual controller — open', () => {
    it('opens the relay, records active state, returns the open timestamp', async () => {
        const { clock } = createFakeClock(NOW);
        const { db } = createDbStub();
        const opens: Zone[] = [];
        const { notifier, calls } = recordingNotifier();
        const controller = createManualController({
            db,
            clock,
            openZone: async (z) => { opens.push(z); },
            closeZone: async () => {},
            notifier,
            isAnyScheduledInFlight: () => false,
        });
        const zone = buildZone();

        const result = await controller.open(zone);

        expect(opens).toHaveLength(1);
        expect(opens[0]?.id).toBe('zone-001');
        expect(result.since.getTime()).toBe(NOW.getTime());
        expect(controller.getActiveZone()).toEqual({ zoneId: 'zone-001', zoneName: 'Front Lawn', since: NOW });
        const started = calls.find(c => c.event === 'watering-started');
        expect(started?.context).toEqual({ zoneName: 'Front Lawn', reason: 'manual' });
    });

    it('rejects with BusyError when a scheduled cycle is in flight', async () => {
        const { clock } = createFakeClock(NOW);
        const { db } = createDbStub();
        let openCalls = 0;
        const controller = createManualController({
            db,
            clock,
            openZone: async () => { openCalls += 1; },
            closeZone: async () => {},
            notifier: async () => {},
            isAnyScheduledInFlight: () => true,
        });

        await expect(controller.open(buildZone())).rejects.toBeInstanceOf(BusyError);
        expect(openCalls).toBe(0);
    });

    it('rejects with BusyError when another manual fire is already active', async () => {
        const { clock } = createFakeClock(NOW);
        const { db } = createDbStub();
        const controller = createManualController({
            db,
            clock,
            openZone: async () => {},
            closeZone: async () => {},
            notifier: async () => {},
            isAnyScheduledInFlight: () => false,
        });
        await controller.open(buildZone());

        await expect(controller.open(buildZone({ id: 'zone-002', name: 'Back' }))).rejects.toBeInstanceOf(BusyError);
    });

    it('does not retain state and emits an error notification when openZone throws', async () => {
        const { clock } = createFakeClock(NOW);
        const { db } = createDbStub();
        const { notifier, calls } = recordingNotifier();
        const controller = createManualController({
            db,
            clock,
            openZone: async () => { throw new Error('HA 502'); },
            closeZone: async () => {},
            notifier,
            isAnyScheduledInFlight: () => false,
        });

        await expect(controller.open(buildZone())).rejects.toThrow('HA 502');
        expect(controller.getActiveZone()).toBeNull();
        const errorCall = calls.find(c => c.event === 'error');
        expect(errorCall?.context).toEqual({ zoneName: 'Front Lawn', operation: 'open', reason: 'HA 502' });
    });
});

describe('manual controller — close', () => {
    it('closes the active zone, inserts schedule_entries with source=manual, updates depletion, clears state', async () => {
        const { clock, advanceTo } = createFakeClock(NOW);
        const { db, inserts, updates } = createDbStub();
        const closes: Zone[] = [];
        const { notifier, calls } = recordingNotifier();
        const controller = createManualController({
            db,
            clock,
            openZone: async () => {},
            closeZone: async (z) => { closes.push(z); },
            notifier,
            isAnyScheduledInFlight: () => false,
        });
        const zone = buildZone();
        await controller.open(zone);
        await advanceTo(new Date('2026-05-04T15:06:00.000Z'));

        await controller.close(zone);

        expect(closes).toHaveLength(1);
        const scheduleInserts = inserts.filter(c => c.table === scheduleEntries);
        expect(scheduleInserts).toHaveLength(1);
        expect(scheduleInserts[0]?.rows[0]).toMatchObject({
            zoneId: 'zone-001',
            scheduleId: null,
            date: '2026-05-04',
            source: 'manual',
        });
        expect(scheduleInserts[0]?.rows[0]?.['appliedDepthMm']).toBeCloseTo(0.9, 1);
        expect(scheduleInserts[0]?.rows[0]?.['depletionBeforeMm']).toBeCloseTo(12, 1);
        const cycleInserts = inserts.filter(c => c.table === irrigationCycles);
        expect(cycleInserts).toHaveLength(1);
        expect(cycleInserts[0]?.rows[0]).toMatchObject({
            scheduleEntryId: 'entry-1',
            firedAt: NOW,
        });
        const zoneUpdate = updates.find(u => u.table === zones);
        expect(zoneUpdate?.values['currentDepletionMm']).toBeCloseTo(11.3, 1);
        expect(controller.getActiveZone()).toBeNull();
        expect(calls.some(c => c.event === 'watering-ended')).toBe(true);
    });

    it('records duration as elapsed time between open and close', async () => {
        const { clock, advanceTo } = createFakeClock(NOW);
        const { db, inserts } = createDbStub();
        const controller = createManualController({
            db,
            clock,
            openZone: async () => {},
            closeZone: async () => {},
            notifier: async () => {},
            isAnyScheduledInFlight: () => false,
        });
        const zone = buildZone();
        await controller.open(zone);
        await advanceTo(new Date('2026-05-04T15:10:00.000Z'));

        await controller.close(zone);

        const cycleInsert = inserts.find(c => c.table === irrigationCycles);
        expect(cycleInsert?.rows[0]?.['durationMin']).toBe(10);
    });

    it('is a no-op success that defensively closes when no manual fire is active', async () => {
        const { clock } = createFakeClock(NOW);
        const { db, inserts } = createDbStub();
        const closes: Zone[] = [];
        const controller = createManualController({
            db,
            clock,
            openZone: async () => {},
            closeZone: async (z) => { closes.push(z); },
            notifier: async () => {},
            isAnyScheduledInFlight: () => false,
        });
        const zone = buildZone();

        const result = await controller.close(zone);

        expect(result).toEqual({ closed: true });
        expect(closes).toHaveLength(1);
        expect(inserts).toHaveLength(0);
    });

    it('clears state even when closeZone rejects so subsequent calls do not see phantom state', async () => {
        const { clock } = createFakeClock(NOW);
        const { db } = createDbStub();
        const { notifier, calls } = recordingNotifier();
        const controller = createManualController({
            db,
            clock,
            openZone: async () => {},
            closeZone: async () => { throw new Error('HA timeout'); },
            notifier,
            isAnyScheduledInFlight: () => false,
        });
        const zone = buildZone();
        await controller.open(zone);

        await expect(controller.close(zone)).rejects.toThrow('HA timeout');

        expect(controller.getActiveZone()).toBeNull();
        const errorCall = calls.find(c => c.event === 'error');
        expect(errorCall?.context?.operation).toBe('close');
    });
});

describe('manual controller — run', () => {
    it('rejects with BusyError when another fire is active', async () => {
        const { clock } = createFakeClock(NOW);
        const { db } = createDbStub();
        const controller = createManualController({
            db,
            clock,
            openZone: async () => {},
            closeZone: async () => {},
            notifier: async () => {},
            isAnyScheduledInFlight: () => false,
        });
        await controller.open(buildZone());

        await expect(controller.run(buildZone({ id: 'zone-002' }), 5)).rejects.toBeInstanceOf(BusyError);
    });

    it('rejects when durationMin is zero, negative, or NaN', async () => {
        const { clock } = createFakeClock(NOW);
        const { db } = createDbStub();
        const controller = createManualController({
            db,
            clock,
            openZone: async () => {},
            closeZone: async () => {},
            notifier: async () => {},
            isAnyScheduledInFlight: () => false,
        });

        await expect(controller.run(buildZone(), 0)).rejects.toThrow(/> 0/);
        await expect(controller.run(buildZone(), -5)).rejects.toThrow(/> 0/);
        await expect(controller.run(buildZone(), Number.NaN)).rejects.toThrow(/> 0/);
    });

    it(`rejects when durationMin exceeds the cap of ${MAX_RUN_DURATION_MIN}`, async () => {
        const { clock } = createFakeClock(NOW);
        const { db } = createDbStub();
        const controller = createManualController({
            db,
            clock,
            openZone: async () => {},
            closeZone: async () => {},
            notifier: async () => {},
            isAnyScheduledInFlight: () => false,
        });

        await expect(controller.run(buildZone(), MAX_RUN_DURATION_MIN + 1)).rejects.toThrow(/exceeds maximum/);
    });

    it('opens, records DB rows synchronously, and schedules the auto-close', async () => {
        const { clock, advanceTo, getPendingCount } = createFakeClock(NOW);
        const { db, inserts, updates } = createDbStub();
        const closes: Zone[] = [];
        const { notifier, calls } = recordingNotifier();
        const controller = createManualController({
            db,
            clock,
            openZone: async () => {},
            closeZone: async (z) => { closes.push(z); },
            notifier,
            isAnyScheduledInFlight: () => false,
        });
        const zone = buildZone();

        const result = await controller.run(zone, 15);

        expect(result.since).toEqual(NOW);
        expect(result.willCloseAt).toEqual(new Date('2026-05-04T15:15:00.000Z'));
        // DB rows written upfront with the planned duration.
        const cycleInsert = inserts.find(c => c.table === irrigationCycles);
        expect(cycleInsert?.rows[0]?.['durationMin']).toBe(15);
        expect(cycleInsert?.rows[0]?.['firedAt']).toEqual(NOW);
        expect(cycleInsert?.rows[0]?.['closedAt']).toBeNull();
        expect(updates.some(u => u.table === zones)).toBe(true);
        const started = calls.find(c => c.event === 'watering-started');
        expect(started?.context).toEqual({ zoneName: 'Front Lawn', durationMin: 15, reason: 'manual' });
        expect(getPendingCount()).toBe(1);

        await advanceTo(new Date('2026-05-04T15:15:30.000Z'));

        expect(closes).toHaveLength(1);
        const closedAtUpdate = updates.find(u => u.table === irrigationCycles && u.values['closedAt'] instanceof Date);
        expect(closedAtUpdate?.values['closedAt']).toEqual(new Date('2026-05-04T15:15:00.000Z'));
        expect(controller.getActiveZone()).toBeNull();
        expect(calls.some(c => c.event === 'watering-ended')).toBe(true);
    });

    it('clears state and emits an error when the auto-close fires but closeZone rejects', async () => {
        const { clock, advanceTo } = createFakeClock(NOW);
        const { db } = createDbStub();
        const { notifier, calls } = recordingNotifier();
        const controller = createManualController({
            db,
            clock,
            openZone: async () => {},
            closeZone: async () => { throw new Error('HA 504'); },
            notifier,
            isAnyScheduledInFlight: () => false,
        });
        const zone = buildZone();

        await controller.run(zone, 5);
        await advanceTo(new Date('2026-05-04T15:05:30.000Z'));

        expect(controller.getActiveZone()).toBeNull();
        const errorCall = calls.find(c => c.event === 'error' && c.context?.operation === 'close');
        expect(errorCall?.context?.reason).toBe('HA 504');
    });

    it('falls back to the flow-rate / area precipitation rate when the zone has no precipitationRateMmPerHr', async () => {
        const { clock } = createFakeClock(NOW);
        const { db, inserts } = createDbStub();
        const controller = createManualController({
            db,
            clock,
            openZone: async () => {},
            closeZone: async () => {},
            notifier: async () => {},
            isAnyScheduledInFlight: () => false,
        });
        // flowRate 15 L/min, area 100 m² → 60*(15/100) = 9 mm/hr. Same as the explicit 9 default.
        const zone = buildZone({ precipitationRateMmPerHr: undefined });

        await controller.run(zone, 10);

        const scheduleInsert = inserts.find(c => c.table === scheduleEntries);
        // 10/60 * 9 = 1.5 mm.
        expect(scheduleInsert?.rows[0]?.['appliedDepthMm']).toBeCloseTo(1.5, 1);
    });

    it('clamps depletionAfter at zero rather than going negative', async () => {
        const { clock } = createFakeClock(NOW);
        const { db, inserts } = createDbStub();
        const controller = createManualController({
            db,
            clock,
            openZone: async () => {},
            closeZone: async () => {},
            notifier: async () => {},
            isAnyScheduledInFlight: () => false,
        });
        // Tiny existing depletion + a long fire that would otherwise overshoot.
        const zone = buildZone({ currentDepletionMm: 0.5 });

        await controller.run(zone, 60);

        const scheduleInsert = inserts.find(c => c.table === scheduleEntries);
        expect(scheduleInsert?.rows[0]?.['depletionAfterMm']).toBe(0);
    });
});

describe('manual controller — getActiveZone and shutdown', () => {
    it('getActiveZone returns null when nothing is active and the snapshot when active', async () => {
        const { clock } = createFakeClock(NOW);
        const { db } = createDbStub();
        const controller = createManualController({
            db,
            clock,
            openZone: async () => {},
            closeZone: async () => {},
            notifier: async () => {},
            isAnyScheduledInFlight: () => false,
        });

        expect(controller.getActiveZone()).toBeNull();

        await controller.open(buildZone({ id: 'zone-007', name: 'Side Strip' }));

        expect(controller.getActiveZone()).toEqual({ zoneId: 'zone-007', zoneName: 'Side Strip', since: NOW });
    });

    it('shutdown closes any active manual zone and cancels the close timer', async () => {
        const { clock, advanceTo, getPendingCount } = createFakeClock(NOW);
        const { db, updates } = createDbStub();
        const closes: Zone[] = [];
        const { notifier, calls } = recordingNotifier();
        const controller = createManualController({
            db,
            clock,
            openZone: async () => {},
            closeZone: async (z) => { closes.push(z); },
            notifier,
            isAnyScheduledInFlight: () => false,
        });
        const zone = buildZone();
        await controller.run(zone, 10);
        expect(getPendingCount()).toBe(1);

        await controller.shutdown();

        expect(closes).toHaveLength(1);
        expect(getPendingCount()).toBe(0);
        expect(controller.getActiveZone()).toBeNull();
        const ended = calls.find(c => c.event === 'watering-ended');
        expect(ended?.context).toEqual({ zoneName: 'Front Lawn', reason: 'shutdown' });
        expect(updates.some(u => u.table === irrigationCycles && u.values['closedAt'] instanceof Date)).toBe(true);

        // Advancing time past the canceled timer must not re-fire the close.
        await advanceTo(new Date('2026-05-04T15:30:00.000Z'));
        expect(closes).toHaveLength(1);
    });

    it('shutdown is a no-op when nothing is active', async () => {
        const { clock } = createFakeClock(NOW);
        const { db } = createDbStub();
        const closes: Zone[] = [];
        const controller = createManualController({
            db,
            clock,
            openZone: async () => {},
            closeZone: async (z) => { closes.push(z); },
            notifier: async () => {},
            isAnyScheduledInFlight: () => false,
        });

        await controller.shutdown();

        expect(closes).toHaveLength(0);
    });
});
