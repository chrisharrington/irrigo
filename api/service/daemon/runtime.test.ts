import { beforeEach, describe, expect, it } from 'bun:test';
import type { AlertEvent, Alerter } from '@/alerts';
import type { Zone } from '@/models';
import type { PersistedCycle } from '@/models/cycle';
import type { NotificationContext, NotificationEvent, Notifier } from '@/notifications';
import type { ScheduleEntriesRepository } from '@/repositories/schedule-entries';
import {
    armCloseOnly,
    armCycle,
    closeAllInFlight,
    TimerRegistry,
    type Clock,
    type TimerHandle,
} from './runtime';
import { setDaemonRepos, type DaemonServiceRepos } from './state';

const NOW = new Date('2026-05-04T12:00:00.000Z');

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
        currentDepletionMm: 0,
        siteId: 'site-001',
        siteTimezone: 'America/Edmonton',
        isEnabled: true,
        homeAssistantEntityId: 'switch.zone_001',
        microclimateFactor: 1,
        location: { lat: 51, lon: -114 },
        ...overrides,
    };
}

function buildCycle(overrides?: Partial<PersistedCycle>): PersistedCycle {
    return {
        id: 'cycle-001',
        startTime: new Date('2026-05-04T13:00:00.000Z'),
        durationMin: 30,
        entryDate: '2026-05-04',
        ...overrides,
    };
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
            const fireAt = currentMs + ms;
            timers.set(handle, { handle, fireAt, cb });
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

    return { clock, advanceTo, flushMicrotasks };
}

type CycleUpdate = { cycleId: string; firedAt?: Date; closedAt?: Date };

function recordingScheduleEntriesRepo(): { repo: ScheduleEntriesRepository; updates: CycleUpdate[] } {
    const updates: CycleUpdate[] = [];
    const repo: ScheduleEntriesRepository = {
        loadFutureCycles: async () => [],
        loadInFlightCycles: async () => [],
        replaceForZone: async () => ({ cycles: [] }),
        markCycleFired: async (cycleId, firedAt) => {
            updates.push({ cycleId, firedAt });
        },
        markCycleClosed: async (cycleId, closedAt) => {
            updates.push({ cycleId, closedAt });
        },
        findScheduledFromDate: async () => [],
    };
    return { repo, updates };
}

function defaultRepos(scheduleEntries: ScheduleEntriesRepository, onAdvanceDepletion?: (zoneId: string, mm: number, reconciledAt: Date) => void): DaemonServiceRepos {
    return {
        zones: {
            loadEnabled: async () => [],
            findById: async () => null,
            count: async () => ({ total: 0, enabled: 0 }),
            loadJoinedRowsForSummary: async () => [],
            loadLatestFires: async () => [],
            advanceDepletion: async (zoneId, mm, reconciledAt) => { onAdvanceDepletion?.(zoneId, mm, reconciledAt); },
        },
        sites: { loadTimezone: async () => 'UTC' },
        schedules: {
            listAll: async () => [],
            loadActiveBySite: async () => new Map(),
            findBySlug: async () => null,
            enable: async () => null,
            disable: async () => null,
            skipActiveTonight: async () => null,
            resumeActiveTonight: async () => null,
            clearStaleSkipMarkers: async () => undefined,
        },
        scheduleEntries,
        schedulingDecisions: {
            record: async () => undefined,
        },
        weatherState: {
            markFetchSuccessful: async () => undefined,
            isStale: async () => false,
        },
        weatherSnapshots: {
            record: async () => 'snapshot-test',
        },
    };
}

type RecordedNotification = { event: NotificationEvent; context: NotificationContext | undefined };

function recordingNotifier(): { notifier: Notifier; calls: RecordedNotification[] } {
    const calls: RecordedNotification[] = [];
    const notifier: Notifier = async (event, context) => {
        calls.push({ event, context });
    };
    return { notifier, calls };
}

function recordingAlerter(): { alerter: Alerter; calls: AlertEvent[] } {
    const calls: AlertEvent[] = [];
    const alerter: Alerter = async (event) => {
        calls.push(event);
    };
    return { alerter, calls };
}

describe('armCycle', () => {
    let repo: ScheduleEntriesRepository;
    let updates: CycleUpdate[];

    beforeEach(() => {
        const recording = recordingScheduleEntriesRepo();
        repo = recording.repo;
        updates = recording.updates;
        setDaemonRepos({ repos: defaultRepos(repo) });
    });

    it('opens the relay at start time and marks firedAt via the repo', async () => {
        const { clock, advanceTo } = createFakeClock(NOW);
        const registry = new TimerRegistry();
        const opens: string[] = [];
        const closes: string[] = [];
        const { notifier } = recordingNotifier();
        const { alerter } = recordingAlerter();

        armCycle({
            clock,
            registry,
            zone: buildZone(),
            cycle: buildCycle({ id: 'cycle-A', durationMin: 10 }),
            openZone: async (z) => { opens.push(z.id); },
            closeZone: async (z) => { closes.push(z.id); },
            notifier,
            alerter,
        });

        await advanceTo(new Date('2026-05-04T13:00:01.000Z'));

        expect(opens).toEqual(['zone-001']);
        expect(updates.some(u => u.cycleId === 'cycle-A' && u.firedAt instanceof Date)).toBe(true);
    });

    it('closes the relay after durationMin and marks closedAt via the repo', async () => {
        const { clock, advanceTo } = createFakeClock(NOW);
        const registry = new TimerRegistry();
        const opens: string[] = [];
        const closes: string[] = [];
        const { notifier } = recordingNotifier();
        const { alerter } = recordingAlerter();

        armCycle({
            clock,
            registry,
            zone: buildZone(),
            cycle: buildCycle({ id: 'cycle-B', durationMin: 5 }),
            openZone: async (z) => { opens.push(z.id); },
            closeZone: async (z) => { closes.push(z.id); },
            notifier,
            alerter,
        });

        await advanceTo(new Date('2026-05-04T13:05:01.000Z'));

        expect(opens).toEqual(['zone-001']);
        expect(closes).toEqual(['zone-001']);
        expect(updates.filter(u => u.cycleId === 'cycle-B').some(u => u.closedAt instanceof Date)).toBe(true);
    });

    it('emits schedule-begun on first cycle when scheduleStart marker is set', async () => {
        const { clock, advanceTo } = createFakeClock(NOW);
        const registry = new TimerRegistry();
        const { notifier, calls } = recordingNotifier();
        const { alerter } = recordingAlerter();

        armCycle({
            clock,
            registry,
            zone: buildZone(),
            cycle: buildCycle(),
            openZone: async () => {},
            closeZone: async () => {},
            notifier,
            alerter,
            scheduleStart: { scheduleNight: '2026-05-04' },
        });

        await advanceTo(new Date('2026-05-04T13:00:01.000Z'));

        expect(calls.some(c => c.event === 'schedule-begun')).toBe(true);
    });

    it('calls advanceDepletion(zone.id, 0, closedAt) on the zones repo after the relay closes', async () => {
        const { clock, advanceTo } = createFakeClock(NOW);
        const registry = new TimerRegistry();
        const { notifier } = recordingNotifier();
        const { alerter } = recordingAlerter();
        const { repo } = recordingScheduleEntriesRepo();
        const depletionAdvances: Array<{ zoneId: string; mm: number; reconciledAt: Date }> = [];
        setDaemonRepos({ repos: defaultRepos(repo, (zoneId, mm, reconciledAt) => depletionAdvances.push({ zoneId, mm, reconciledAt })) });

        armCycle({
            clock,
            registry,
            zone: buildZone({ id: 'zone-depletion' }),
            cycle: buildCycle({ id: 'cycle-dep', durationMin: 5 }),
            openZone: async () => {},
            closeZone: async () => {},
            notifier,
            alerter,
        });

        await advanceTo(new Date('2026-05-04T13:05:01.000Z'));

        expect(depletionAdvances).toHaveLength(1);
        expect(depletionAdvances[0]?.zoneId).toBe('zone-depletion');
        expect(depletionAdvances[0]?.mm).toBe(0);
        expect(depletionAdvances[0]?.reconciledAt).toBeInstanceOf(Date);
    });

    it('records HA open-failure alert and skips firedAt write on openZone error', async () => {
        const { clock, advanceTo } = createFakeClock(NOW);
        const registry = new TimerRegistry();
        const { notifier } = recordingNotifier();
        const { alerter, calls } = recordingAlerter();

        armCycle({
            clock,
            registry,
            zone: buildZone(),
            cycle: buildCycle({ id: 'cycle-fail' }),
            openZone: async () => { throw new Error('HA 502'); },
            closeZone: async () => {},
            notifier,
            alerter,
        });

        await advanceTo(new Date('2026-05-04T13:00:01.000Z'));

        expect(calls.some(c => c.class === 'ha-call-failed' && c.title === 'HA open failed')).toBe(true);
        expect(updates.some(u => u.cycleId === 'cycle-fail' && u.firedAt)).toBe(false);
    });
});

describe('armCloseOnly', () => {
    let repo: ScheduleEntriesRepository;
    let updates: CycleUpdate[];

    beforeEach(() => {
        const recording = recordingScheduleEntriesRepo();
        repo = recording.repo;
        updates = recording.updates;
        setDaemonRepos({ repos: defaultRepos(repo) });
    });

    it('fires the close at plannedCloseAt and marks closedAt via the repo', async () => {
        const { clock, advanceTo } = createFakeClock(NOW);
        const registry = new TimerRegistry();
        const closes: string[] = [];
        const { notifier } = recordingNotifier();
        const { alerter } = recordingAlerter();

        armCloseOnly({
            clock,
            registry,
            zone: buildZone(),
            cycle: buildCycle({ id: 'cycle-X' }),
            closeZone: async (z) => { closes.push(z.id); },
            notifier,
            alerter,
            plannedCloseAt: new Date('2026-05-04T12:30:00.000Z'),
        });

        await advanceTo(new Date('2026-05-04T12:30:01.000Z'));

        expect(closes).toEqual(['zone-001']);
        expect(updates.some(u => u.cycleId === 'cycle-X' && u.closedAt instanceof Date)).toBe(true);
    });

    it('fires immediately when plannedCloseAt is already in the past', async () => {
        const { clock, advanceTo } = createFakeClock(NOW);
        const registry = new TimerRegistry();
        const closes: string[] = [];
        const { notifier } = recordingNotifier();
        const { alerter } = recordingAlerter();

        armCloseOnly({
            clock,
            registry,
            zone: buildZone(),
            cycle: buildCycle({ id: 'cycle-late' }),
            closeZone: async (z) => { closes.push(z.id); },
            notifier,
            alerter,
            plannedCloseAt: new Date('2026-05-04T10:00:00.000Z'),
        });

        await advanceTo(new Date('2026-05-04T12:00:01.000Z'));

        expect(closes).toEqual(['zone-001']);
    });

    it('pre-registers the cycle as in-flight so getStatus reflects it before the close fires', async () => {
        const { clock } = createFakeClock(NOW);
        const registry = new TimerRegistry();
        const { notifier } = recordingNotifier();
        const { alerter } = recordingAlerter();

        armCloseOnly({
            clock,
            registry,
            zone: buildZone({ id: 'zone-resumed' }),
            cycle: buildCycle({ id: 'cycle-resumed' }),
            closeZone: async () => {},
            notifier,
            alerter,
            plannedCloseAt: new Date('2026-05-04T12:30:00.000Z'),
        });

        const inFlight = registry.snapshotInFlight();
        expect(inFlight).toHaveLength(1);
        expect(inFlight[0]?.cycleId).toBe('cycle-resumed');
        expect(inFlight[0]?.zone.id).toBe('zone-resumed');
    });

    it('records HA close-failure alert when closeZone throws', async () => {
        const { clock, advanceTo } = createFakeClock(NOW);
        const registry = new TimerRegistry();
        const { notifier } = recordingNotifier();
        const { alerter, calls } = recordingAlerter();

        armCloseOnly({
            clock,
            registry,
            zone: buildZone(),
            cycle: buildCycle({ id: 'cycle-bad' }),
            closeZone: async () => { throw new Error('HA 504'); },
            notifier,
            alerter,
            plannedCloseAt: new Date('2026-05-04T12:30:00.000Z'),
        });

        await advanceTo(new Date('2026-05-04T12:30:01.000Z'));

        expect(calls.some(c => c.class === 'ha-call-failed' && c.title === 'HA close failed')).toBe(true);
    });
});

describe('closeAllInFlight', () => {
    let repo: ScheduleEntriesRepository;
    let updates: CycleUpdate[];

    beforeEach(() => {
        const recording = recordingScheduleEntriesRepo();
        repo = recording.repo;
        updates = recording.updates;
        setDaemonRepos({ repos: defaultRepos(repo) });
    });

    it('closes every in-flight relay and marks closedAt for each', async () => {
        const { clock } = createFakeClock(NOW);
        const registry = new TimerRegistry();
        const closes: string[] = [];
        const { alerter } = recordingAlerter();

        registry.addInFlight('cycle-A', buildZone({ id: 'zone-A' }), 1, new Date());
        registry.addInFlight('cycle-B', buildZone({ id: 'zone-B' }), 2, new Date());

        await closeAllInFlight({ clock, registry, closeZone: async (z) => { closes.push(z.id); }, alerter });

        expect(closes.sort()).toEqual(['zone-A', 'zone-B']);
        expect(updates.filter(u => u.closedAt).map(u => u.cycleId).sort()).toEqual(['cycle-A', 'cycle-B']);
    });

    it('records an alert when one of the closes throws, and continues with the rest', async () => {
        const { clock } = createFakeClock(NOW);
        const registry = new TimerRegistry();
        const closes: string[] = [];
        const { alerter, calls: alertCalls } = recordingAlerter();

        registry.addInFlight('cycle-A', buildZone({ id: 'zone-A' }), 1, new Date());
        registry.addInFlight('cycle-B', buildZone({ id: 'zone-B' }), 2, new Date());

        await closeAllInFlight({
            clock,
            registry,
            closeZone: async (z) => {
                if (z.id === 'zone-A') throw new Error('HA 504');
                closes.push(z.id);
            },
            alerter,
        });

        expect(closes).toEqual(['zone-B']);
        expect(alertCalls.some(a => a.class === 'ha-call-failed' && a.title === 'HA close failed during shutdown')).toBe(true);
    });

    it('is a no-op when nothing is in flight', async () => {
        const { clock } = createFakeClock(NOW);
        const registry = new TimerRegistry();
        const closes: string[] = [];
        const { alerter } = recordingAlerter();

        await closeAllInFlight({ clock, registry, closeZone: async (z) => { closes.push(z.id); }, alerter });

        expect(closes).toEqual([]);
    });
});
