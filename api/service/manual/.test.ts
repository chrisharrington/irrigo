import { beforeEach, describe, expect, it } from 'bun:test';
import type { Zone } from '@/models';
import type { ManualRepository } from '@/repositories/manual';
import type { Clock, TimerHandle } from '@/service/daemon/runtime';
import type { NotificationContext, NotificationEvent, Notifier } from '@/notifications';
import {
    BusyError,
    bootManualService,
    createManualController,
    MAX_RUN_DURATION_MIN,
    SystemDisabledError,
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

type WriteCall = { zone: Zone; openedAt: Date; closedAt: Date | null; durationMin: number };
type UpdateCall = { cycleId: string; closedAt: Date };

function fakeRepo(overrides?: {
    cycleId?: string | null;
}): { repo: ManualRepository; writes: WriteCall[]; updates: UpdateCall[] } {
    const writes: WriteCall[] = [];
    const updates: UpdateCall[] = [];
    const repo: ManualRepository = {
        writeManualRecord: async (zone, openedAt, closedAt, durationMin) => {
            writes.push({ zone, openedAt, closedAt, durationMin });
            return overrides?.cycleId !== undefined ? overrides.cycleId : `cycle-${writes.length}`;
        },
        updateCycleClosedAt: async (cycleId, closedAt) => {
            updates.push({ cycleId, closedAt });
        },
    };
    return { repo, writes, updates };
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
        siteId: 'site-A',
        siteTimezone: 'America/Edmonton',
        isEnabled: true,
        homeAssistantEntityId: 'switch.zone_001',
        microclimateFactor: 1,
        location: { lat: 51, lon: -114 },
        ...overrides,
    };
}

const NOW = new Date('2026-05-04T15:00:00.000Z');

describe('manual controller — open', () => {
    let writes: WriteCall[];
    let updates: UpdateCall[];

    beforeEach(() => {
        const r = fakeRepo();
        writes = r.writes;
        updates = r.updates;
        bootManualService({ repo: r.repo });
    });

    it('opens the relay, records active state, returns the open timestamp', async () => {
        const { clock } = createFakeClock(NOW);
        const opens: Zone[] = [];
        const { notifier, calls } = recordingNotifier();
        const controller = createManualController({
            clock,
            openZone: async (z) => { opens.push(z); },
            closeZone: async () => {},
            notifier,
            isAnyScheduledInFlight: () => false,
            isIrrigationEnabled: async () => true,
        });
        const zone = buildZone();

        const result = await controller.open(zone);

        expect(opens).toHaveLength(1);
        expect(opens[0]?.id).toBe('zone-001');
        expect(result.since.getTime()).toBe(NOW.getTime());
        expect(controller.getActiveZone()).toEqual({ zoneId: 'zone-001', zoneName: 'Front Lawn', since: NOW, willCloseAt: null });
        const started = calls.find(c => c.event === 'watering-started');
        expect(started?.context).toEqual({ zoneName: 'Front Lawn', reason: 'manual' });
        // `open` alone doesn't write — the write happens at close (or up-front in `run`).
        expect(writes).toHaveLength(0);
        expect(updates).toHaveLength(0);
    });

    it('rejects with BusyError when a scheduled cycle is in flight', async () => {
        const { clock } = createFakeClock(NOW);
        let openCalls = 0;
        const controller = createManualController({
            clock,
            openZone: async () => { openCalls += 1; },
            closeZone: async () => {},
            notifier: async () => {},
            isAnyScheduledInFlight: () => true,
            isIrrigationEnabled: async () => true,
        });

        await expect(controller.open(buildZone())).rejects.toBeInstanceOf(BusyError);
        expect(openCalls).toBe(0);
    });

    it('rejects with BusyError when another manual fire is already active', async () => {
        const { clock } = createFakeClock(NOW);
        const controller = createManualController({
            clock,
            openZone: async () => {},
            closeZone: async () => {},
            notifier: async () => {},
            isAnyScheduledInFlight: () => false,
            isIrrigationEnabled: async () => true,
        });
        await controller.open(buildZone());

        await expect(controller.open(buildZone({ id: 'zone-002', name: 'Back' }))).rejects.toBeInstanceOf(BusyError);
    });

    it('does not retain state and emits an error notification when openZone throws', async () => {
        const { clock } = createFakeClock(NOW);
        const { notifier, calls } = recordingNotifier();
        const controller = createManualController({
            clock,
            openZone: async () => { throw new Error('HA 502'); },
            closeZone: async () => {},
            notifier,
            isAnyScheduledInFlight: () => false,
            isIrrigationEnabled: async () => true,
        });

        await expect(controller.open(buildZone())).rejects.toThrow('HA 502');
        expect(controller.getActiveZone()).toBeNull();
        const errorCall = calls.find(c => c.event === 'error');
        expect(errorCall?.context).toEqual({ zoneName: 'Front Lawn', errorTitle: 'Manual open failed', errorSub: 'Last attempt failed: HA 502.' });
    });
});

describe('manual controller — close', () => {
    let writes: WriteCall[];
    let updates: UpdateCall[];

    beforeEach(() => {
        const r = fakeRepo();
        writes = r.writes;
        updates = r.updates;
        bootManualService({ repo: r.repo });
    });

    it('closes the active zone, calls writeManualRecord with elapsed duration, clears state', async () => {
        const { clock, advanceTo } = createFakeClock(NOW);
        const closes: Zone[] = [];
        const { notifier, calls } = recordingNotifier();
        const controller = createManualController({
            clock,
            openZone: async () => {},
            closeZone: async (z) => { closes.push(z); },
            notifier,
            isAnyScheduledInFlight: () => false,
            isIrrigationEnabled: async () => true,
        });
        const zone = buildZone();
        await controller.open(zone);
        await advanceTo(new Date('2026-05-04T15:06:00.000Z'));

        await controller.close(zone);

        expect(closes).toHaveLength(1);
        expect(writes).toHaveLength(1);
        expect(writes[0]?.zone.id).toBe('zone-001');
        expect(writes[0]?.openedAt).toEqual(NOW);
        expect(writes[0]?.closedAt).toEqual(new Date('2026-05-04T15:06:00.000Z'));
        expect(writes[0]?.durationMin).toBeCloseTo(6, 5);
        // close on an `open`-then-`close` path uses writeManualRecord, not updateCycleClosedAt.
        expect(updates).toHaveLength(0);
        expect(controller.getActiveZone()).toBeNull();
        expect(calls.some(c => c.event === 'watering-ended')).toBe(true);
    });

    it('records duration as elapsed time between open and close', async () => {
        const { clock, advanceTo } = createFakeClock(NOW);
        const controller = createManualController({
            clock,
            openZone: async () => {},
            closeZone: async () => {},
            notifier: async () => {},
            isAnyScheduledInFlight: () => false,
            isIrrigationEnabled: async () => true,
        });
        const zone = buildZone();
        await controller.open(zone);
        await advanceTo(new Date('2026-05-04T15:10:00.000Z'));

        await controller.close(zone);

        expect(writes[0]?.durationMin).toBe(10);
    });

    it('is a no-op success that defensively closes when no manual fire is active', async () => {
        const { clock } = createFakeClock(NOW);
        const closes: Zone[] = [];
        const controller = createManualController({
            clock,
            openZone: async () => {},
            closeZone: async (z) => { closes.push(z); },
            notifier: async () => {},
            isAnyScheduledInFlight: () => false,
            isIrrigationEnabled: async () => true,
        });
        const zone = buildZone();

        const result = await controller.close(zone);

        expect(result).toEqual({ closed: true });
        expect(closes).toHaveLength(1);
        expect(writes).toHaveLength(0);
        expect(updates).toHaveLength(0);
    });

    it('clears state even when closeZone rejects so subsequent calls do not see phantom state', async () => {
        const { clock } = createFakeClock(NOW);
        const { notifier, calls } = recordingNotifier();
        const controller = createManualController({
            clock,
            openZone: async () => {},
            closeZone: async () => { throw new Error('HA timeout'); },
            notifier,
            isAnyScheduledInFlight: () => false,
            isIrrigationEnabled: async () => true,
        });
        const zone = buildZone();
        await controller.open(zone);

        await expect(controller.close(zone)).rejects.toThrow('HA timeout');

        expect(controller.getActiveZone()).toBeNull();
        const errorCall = calls.find(c => c.event === 'error');
        expect(errorCall?.context?.errorTitle).toBe('Manual close failed');
    });
});

describe('manual controller — run', () => {
    let writes: WriteCall[];
    let updates: UpdateCall[];

    beforeEach(() => {
        const r = fakeRepo();
        writes = r.writes;
        updates = r.updates;
        bootManualService({ repo: r.repo });
    });

    it('rejects with BusyError when another fire is active', async () => {
        const { clock } = createFakeClock(NOW);
        const controller = createManualController({
            clock,
            openZone: async () => {},
            closeZone: async () => {},
            notifier: async () => {},
            isAnyScheduledInFlight: () => false,
            isIrrigationEnabled: async () => true,
        });
        await controller.open(buildZone());

        await expect(controller.run(buildZone({ id: 'zone-002' }), 5)).rejects.toBeInstanceOf(BusyError);
    });

    it('rejects when durationMin is zero, negative, or NaN', async () => {
        const { clock } = createFakeClock(NOW);
        const controller = createManualController({
            clock,
            openZone: async () => {},
            closeZone: async () => {},
            notifier: async () => {},
            isAnyScheduledInFlight: () => false,
            isIrrigationEnabled: async () => true,
        });

        await expect(controller.run(buildZone(), 0)).rejects.toThrow(/> 0/);
        await expect(controller.run(buildZone(), -5)).rejects.toThrow(/> 0/);
        await expect(controller.run(buildZone(), Number.NaN)).rejects.toThrow(/> 0/);
    });

    it(`rejects when durationMin exceeds the cap of ${MAX_RUN_DURATION_MIN}`, async () => {
        const { clock } = createFakeClock(NOW);
        const controller = createManualController({
            clock,
            openZone: async () => {},
            closeZone: async () => {},
            notifier: async () => {},
            isAnyScheduledInFlight: () => false,
            isIrrigationEnabled: async () => true,
        });

        await expect(controller.run(buildZone(), MAX_RUN_DURATION_MIN + 1)).rejects.toThrow(/exceeds maximum/);
    });

    it('opens, calls writeManualRecord upfront with the planned duration, and schedules the auto-close', async () => {
        const { clock, advanceTo, getPendingCount } = createFakeClock(NOW);
        const closes: Zone[] = [];
        const { notifier, calls } = recordingNotifier();
        const controller = createManualController({
            clock,
            openZone: async () => {},
            closeZone: async (z) => { closes.push(z); },
            notifier,
            isAnyScheduledInFlight: () => false,
            isIrrigationEnabled: async () => true,
        });
        const zone = buildZone();

        const result = await controller.run(zone, 15);

        expect(result.since).toEqual(NOW);
        expect(result.willCloseAt).toEqual(new Date('2026-05-04T15:15:00.000Z'));
        expect(writes).toHaveLength(1);
        expect(writes[0]?.durationMin).toBe(15);
        expect(writes[0]?.openedAt).toEqual(NOW);
        expect(writes[0]?.closedAt).toBeNull();
        const started = calls.find(c => c.event === 'watering-started');
        expect(started?.context).toEqual({ zoneName: 'Front Lawn', durationMin: 15, reason: 'manual' });
        expect(getPendingCount()).toBe(1);

        await advanceTo(new Date('2026-05-04T15:15:30.000Z'));

        expect(closes).toHaveLength(1);
        // Scheduled close path calls updateCycleClosedAt with the cycle id returned by writeManualRecord.
        expect(updates).toHaveLength(1);
        expect(updates[0]?.cycleId).toBe('cycle-1');
        expect(updates[0]?.closedAt).toEqual(new Date('2026-05-04T15:15:00.000Z'));
        expect(controller.getActiveZone()).toBeNull();
        expect(calls.some(c => c.event === 'watering-ended')).toBe(true);
    });

    it('clears state and emits an error when the auto-close fires but closeZone rejects', async () => {
        const { clock, advanceTo } = createFakeClock(NOW);
        const { notifier, calls } = recordingNotifier();
        const controller = createManualController({
            clock,
            openZone: async () => {},
            closeZone: async () => { throw new Error('HA 504'); },
            notifier,
            isAnyScheduledInFlight: () => false,
            isIrrigationEnabled: async () => true,
        });
        const zone = buildZone();

        await controller.run(zone, 5);
        await advanceTo(new Date('2026-05-04T15:05:30.000Z'));

        expect(controller.getActiveZone()).toBeNull();
        const errorCall = calls.find(c => c.event === 'error' && c.context?.errorTitle === 'Manual close failed');
        expect(errorCall?.context?.errorSub).toBe('Last attempt failed: HA 504.');
    });
});

describe('manual controller — master kill switch', () => {
    beforeEach(() => {
        bootManualService({ repo: fakeRepo().repo });
    });

    it('open rejects with SystemDisabledError when isIrrigationEnabled returns false; no HA call, no notifier', async () => {
        const { clock } = createFakeClock(NOW);
        let openCalls = 0;
        const { notifier, calls } = recordingNotifier();
        const controller = createManualController({
            clock,
            openZone: async () => { openCalls += 1; },
            closeZone: async () => {},
            notifier,
            isAnyScheduledInFlight: () => false,
            isIrrigationEnabled: async () => false,
        });

        await expect(controller.open(buildZone())).rejects.toBeInstanceOf(SystemDisabledError);
        expect(openCalls).toBe(0);
        expect(calls).toHaveLength(0);
        expect(controller.getActiveZone()).toBeNull();
    });

    it('run rejects with SystemDisabledError when isIrrigationEnabled returns false; no HA call', async () => {
        const { clock } = createFakeClock(NOW);
        let openCalls = 0;
        const controller = createManualController({
            clock,
            openZone: async () => { openCalls += 1; },
            closeZone: async () => {},
            notifier: async () => {},
            isAnyScheduledInFlight: () => false,
            isIrrigationEnabled: async () => false,
        });

        await expect(controller.run(buildZone(), 5)).rejects.toBeInstanceOf(SystemDisabledError);
        expect(openCalls).toBe(0);
    });

    it('close is NOT gated by the kill switch — an open relay must always be stoppable', async () => {
        const { clock } = createFakeClock(NOW);
        let enabled = true;
        let closeCalls = 0;
        const controller = createManualController({
            clock,
            openZone: async () => {},
            closeZone: async () => { closeCalls += 1; },
            notifier: async () => {},
            isAnyScheduledInFlight: () => false,
            isIrrigationEnabled: async () => enabled,
        });

        const zone = buildZone();
        await controller.open(zone);
        enabled = false; // flip the kill switch while the relay is open

        const result = await controller.close(zone);

        expect(result.closed).toBe(true);
        expect(closeCalls).toBe(1);
        expect(controller.getActiveZone()).toBeNull();
    });

    it('defensive close on an unknown zone is NOT gated either', async () => {
        const { clock } = createFakeClock(NOW);
        let closeCalls = 0;
        const controller = createManualController({
            clock,
            openZone: async () => {},
            closeZone: async () => { closeCalls += 1; },
            notifier: async () => {},
            isAnyScheduledInFlight: () => false,
            isIrrigationEnabled: async () => false,
        });

        const result = await controller.close(buildZone());

        expect(result.closed).toBe(true);
        expect(closeCalls).toBe(1);
    });
});

describe('manual controller — getActiveZone and shutdown', () => {
    let updates: UpdateCall[];

    beforeEach(() => {
        const r = fakeRepo();
        updates = r.updates;
        bootManualService({ repo: r.repo });
    });

    it('getActiveZone returns null when nothing is active and the snapshot when active', async () => {
        const { clock } = createFakeClock(NOW);
        const controller = createManualController({
            clock,
            openZone: async () => {},
            closeZone: async () => {},
            notifier: async () => {},
            isAnyScheduledInFlight: () => false,
            isIrrigationEnabled: async () => true,
        });

        expect(controller.getActiveZone()).toBeNull();

        await controller.open(buildZone({ id: 'zone-007', name: 'Side Strip' }));

        expect(controller.getActiveZone()).toEqual({ zoneId: 'zone-007', zoneName: 'Side Strip', since: NOW, willCloseAt: null });
    });

    it('getActiveZone surfaces willCloseAt as openedAt + durationMin after run()', async () => {
        const { clock } = createFakeClock(NOW);
        const controller = createManualController({
            clock,
            openZone: async () => {},
            closeZone: async () => {},
            notifier: async () => {},
            isAnyScheduledInFlight: () => false,
            isIrrigationEnabled: async () => true,
        });

        await controller.run(buildZone({ id: 'zone-007', name: 'Side Strip' }), 12);

        const snapshot = controller.getActiveZone();
        expect(snapshot?.zoneId).toBe('zone-007');
        expect(snapshot?.willCloseAt).toEqual(new Date(NOW.getTime() + 12 * 60_000));
    });

    it('shutdown closes any active manual zone and cancels the close timer', async () => {
        const { clock, advanceTo, getPendingCount } = createFakeClock(NOW);
        const closes: Zone[] = [];
        const { notifier, calls } = recordingNotifier();
        const controller = createManualController({
            clock,
            openZone: async () => {},
            closeZone: async (z) => { closes.push(z); },
            notifier,
            isAnyScheduledInFlight: () => false,
            isIrrigationEnabled: async () => true,
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
        // shutdown stamps closed_at via the repo.
        expect(updates).toHaveLength(1);

        // Advancing time past the canceled timer must not re-fire the close.
        await advanceTo(new Date('2026-05-04T15:30:00.000Z'));
        expect(closes).toHaveLength(1);
    });

    it('shutdown is a no-op when nothing is active', async () => {
        const { clock } = createFakeClock(NOW);
        const closes: Zone[] = [];
        const controller = createManualController({
            clock,
            openZone: async () => {},
            closeZone: async (z) => { closes.push(z); },
            notifier: async () => {},
            isAnyScheduledInFlight: () => false,
            isIrrigationEnabled: async () => true,
        });

        await controller.shutdown();

        expect(closes).toHaveLength(0);
    });
});
