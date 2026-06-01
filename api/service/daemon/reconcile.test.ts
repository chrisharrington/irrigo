import { beforeEach, describe, expect, it } from 'bun:test';
import type { AlertEvent, Alerter } from '@/alerts';
import type { ZoneRelayState } from '@/data/home-assistant';
import type { Zone } from '@/models';
import type { FutureCyclePair } from '@/models/cycle';
import type { NotificationContext, NotificationEvent, Notifier } from '@/notifications';
import type { ScheduleEntriesRepository } from '@/repositories/schedule-entries';
import { reconcileCycleAndRelayState, type ReconcileDeps } from './reconcile';
import type { ArmCloseOnlyInputs, Clock, TimerHandle, TimerRegistry } from './runtime';
import { setDaemonRepos, type DaemonServiceRepos } from './state';

type RecordedNotification = { event: NotificationEvent; context: NotificationContext | undefined };

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
        siteId: 'site-A',
        siteTimezone: 'America/Edmonton',
        isEnabled: true,
        homeAssistantEntityId: 'switch.zone_001',
        microclimateFactor: 1,
        location: { lat: 51, lon: -114 },
        ...overrides,
    };
}

function buildPair(overrides?: {
    cycleId?: string;
    startTime?: Date;
    durationMin?: number;
    zone?: Partial<Zone>;
}): FutureCyclePair {
    return {
        cycle: {
            id: overrides?.cycleId ?? 'cycle-001',
            startTime: overrides?.startTime ?? new Date('2026-05-04T11:30:00.000Z'),
            durationMin: overrides?.durationMin ?? 60,
            entryDate: '2026-05-04',
        },
        zone: buildZone(overrides?.zone),
    };
}

function fakeClock(initial: Date): Clock {
    return {
        now: () => initial,
        setTimeout: () => 1 as TimerHandle,
        clearTimeout: () => {},
    };
}

type CycleUpdate = { cycleId: string; closedAt: Date };

function recordingScheduleEntriesRepo(): { repo: ScheduleEntriesRepository; updates: CycleUpdate[] } {
    const updates: CycleUpdate[] = [];
    const repo: ScheduleEntriesRepository = {
        loadFutureCycles: async () => [],
        loadInFlightCycles: async () => [],
        replaceForZone: async () => ({ cycles: [] }),
        markCycleFired: async () => undefined,
        markCycleClosed: async (cycleId, closedAt) => {
            updates.push({ cycleId, closedAt });
        },
        findScheduledFromDate: async () => [],
    };
    return { repo, updates };
}

function defaultRepos(scheduleEntries: ScheduleEntriesRepository): DaemonServiceRepos {
    return {
        zones: {
            loadEnabled: async () => [],
            findById: async () => null,
            count: async () => ({ total: 0, enabled: 0 }),
            loadJoinedRowsForSummary: async () => [],
            loadLatestFires: async () => [],
            advanceDepletion: async () => {},
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

function buildDeps(overrides: {
    inFlight?: FutureCyclePair[];
    managedZones?: Zone[];
    state?: (zone: Zone) => Promise<ZoneRelayState> | ZoneRelayState;
    closeFn?: (zone: Zone) => Promise<void>;
    armCloseOnly?: (inputs: ArmCloseOnlyInputs) => void;
    now?: Date;
}): {
    deps: ReconcileDeps;
    closes: Zone[];
    armCalls: ArmCloseOnlyInputs[];
    notifications: RecordedNotification[];
    alertCalls: AlertEvent[];
} {
    const closes: Zone[] = [];
    const armCalls: ArmCloseOnlyInputs[] = [];
    const notifications: RecordedNotification[] = [];
    const now = overrides.now ?? NOW;

    const registry: TimerRegistry = {
        addOpen: () => {},
        consumeOpen: () => {},
        addInFlight: () => {},
        clearInFlight: () => {},
        setRePlanHandle: () => {},
        cancelOpenTimers: () => {},
        cancelAllTimers: () => {},
        snapshotInFlight: () => [],
    } as unknown as TimerRegistry;

    const notifier: Notifier = async (event, context) => {
        notifications.push({ event, context });
    };

    const alertCalls: AlertEvent[] = [];
    const alerter: Alerter = async (event) => {
        alertCalls.push(event);
    };

    return {
        closes,
        armCalls,
        notifications,
        alertCalls,
        deps: {
            clock: fakeClock(now),
            registry,
            notifier,
            alerter,
            closeZone: overrides.closeFn ?? (async (zone) => { closes.push(zone); }),
            getZoneState: async (zone) => {
                if (!overrides.state) return 'unknown';
                return overrides.state(zone);
            },
            loadInFlightCycles: async () => overrides.inFlight ?? [],
            armCloseOnly: overrides.armCloseOnly ?? ((inputs) => { armCalls.push(inputs); }),
            managedZones: overrides.managedZones ?? [],
        },
    };
}

let cycleUpdates: CycleUpdate[];

beforeEach(() => {
    const recording = recordingScheduleEntriesRepo();
    cycleUpdates = recording.updates;
    setDaemonRepos({ repos: defaultRepos(recording.repo) });
});

describe('reconcileCycleAndRelayState — in-flight cycle handling', () => {
    it(`re-arms the close timer when HA is 'on' and planned close is in the future`, async () => {
        const pair = buildPair({
            cycleId: 'cycle-future',
            startTime: new Date('2026-05-04T11:30:00.000Z'),
            durationMin: 60,
        });
        const sweep = buildZone({ id: 'zone-sweep' });
        const { deps, armCalls, closes } = buildDeps({
            inFlight: [pair],
            managedZones: [pair.zone, sweep],
            state: async (zone): Promise<ZoneRelayState> => zone.id === pair.zone.id ? 'on' : 'off',
        });

        const summary = await reconcileCycleAndRelayState(deps);

        expect(summary).toMatchObject({ resumed: 1, forcedClosed: 0, missedClose: 0, orphansClosed: 0, errors: 0 });
        expect(armCalls).toHaveLength(1);
        expect(armCalls[0]?.cycle.id).toBe('cycle-future');
        expect(armCalls[0]?.plannedCloseAt).toEqual(new Date('2026-05-04T12:30:00.000Z'));
        expect(closes).toHaveLength(0);
        expect(cycleUpdates).toHaveLength(0);
    });

    it(`force-closes when HA is 'on' but planned close is in the past`, async () => {
        const pair = buildPair({
            cycleId: 'cycle-overrun',
            startTime: new Date('2026-05-04T10:00:00.000Z'),
            durationMin: 30,
        });
        const { deps, closes } = buildDeps({
            inFlight: [pair],
            state: async (): Promise<ZoneRelayState> => 'on',
        });

        const summary = await reconcileCycleAndRelayState(deps);

        expect(summary).toMatchObject({ resumed: 0, forcedClosed: 1, missedClose: 0, orphansClosed: 0 });
        expect(closes).toHaveLength(1);
        expect(cycleUpdates).toEqual([{ cycleId: 'cycle-overrun', closedAt: NOW }]);
    });

    it(`records closed_at = plannedCloseAt when HA is 'off' and the planned close is earlier than now`, async () => {
        const pair = buildPair({
            cycleId: 'cycle-missed',
            startTime: new Date('2026-05-04T10:00:00.000Z'),
            durationMin: 30,
        });
        const { deps, closes } = buildDeps({
            inFlight: [pair],
            state: async (): Promise<ZoneRelayState> => 'off',
        });

        const summary = await reconcileCycleAndRelayState(deps);

        expect(summary).toMatchObject({ missedClose: 1 });
        expect(cycleUpdates).toEqual([{ cycleId: 'cycle-missed', closedAt: new Date('2026-05-04T10:30:00.000Z') }]);
        expect(closes).toHaveLength(0);
    });

    it(`records closed_at = now when HA is 'off' and the planned close is still in the future`, async () => {
        const pair = buildPair({
            cycleId: 'cycle-missed-early',
            startTime: new Date('2026-05-04T11:30:00.000Z'),
            durationMin: 60,
        });
        const { deps } = buildDeps({
            inFlight: [pair],
            state: async (): Promise<ZoneRelayState> => 'off',
        });

        await reconcileCycleAndRelayState(deps);

        expect(cycleUpdates).toEqual([{ cycleId: 'cycle-missed-early', closedAt: NOW }]);
    });

    it(`leaves the cycle alone when HA returns 'unknown' and does not mark the zone handled`, async () => {
        const pair = buildPair({ cycleId: 'cycle-unknown' });
        const { deps, closes, armCalls } = buildDeps({
            inFlight: [pair],
            managedZones: [pair.zone],
            state: async (): Promise<ZoneRelayState> => 'unknown',
        });

        const summary = await reconcileCycleAndRelayState(deps);

        expect(summary).toMatchObject({ resumed: 0, forcedClosed: 0, missedClose: 0, orphansClosed: 0, errors: 0 });
        expect(cycleUpdates).toHaveLength(0);
        expect(closes).toHaveLength(0);
        expect(armCalls).toHaveLength(0);
    });

    it('counts an error and skips the cycle when getZoneState throws', async () => {
        const pair = buildPair({ cycleId: 'cycle-err' });
        const { deps, closes } = buildDeps({
            inFlight: [pair],
            state: async () => { throw new Error('HA timeout'); },
        });

        const summary = await reconcileCycleAndRelayState(deps);

        expect(summary).toMatchObject({ errors: 1 });
        expect(cycleUpdates).toHaveLength(0);
        expect(closes).toHaveLength(0);
    });
});

describe('reconcileCycleAndRelayState — defensive sweep', () => {
    it(`force-closes a managed zone HA reports 'on' with no in-flight cycle`, async () => {
        const orphan = buildZone({ id: 'zone-orphan', name: 'Orphan' });
        const { deps, closes } = buildDeps({
            managedZones: [orphan],
            state: async (): Promise<ZoneRelayState> => 'on',
        });

        const summary = await reconcileCycleAndRelayState(deps);

        expect(summary).toMatchObject({ orphansClosed: 1 });
        expect(closes).toEqual([orphan]);
    });

    it(`takes no action for a managed zone HA reports 'off'`, async () => {
        const calm = buildZone({ id: 'zone-calm' });
        const { deps, closes } = buildDeps({
            managedZones: [calm],
            state: async (): Promise<ZoneRelayState> => 'off',
        });

        const summary = await reconcileCycleAndRelayState(deps);

        expect(summary).toMatchObject({ orphansClosed: 0 });
        expect(closes).toHaveLength(0);
    });

    it('skips a zone that was already handled as an in-flight cycle', async () => {
        const zone = buildZone({ id: 'zone-shared' });
        const pair = buildPair({ cycleId: 'cycle-shared', zone: { id: 'zone-shared' } });
        const { deps, closes } = buildDeps({
            inFlight: [pair],
            managedZones: [zone],
            state: async (): Promise<ZoneRelayState> => 'off',
        });

        const summary = await reconcileCycleAndRelayState(deps);

        expect(summary).toMatchObject({ missedClose: 1, orphansClosed: 0 });
        expect(closes).toHaveLength(0);
    });

    it('skips a zone with no homeAssistantEntityId', async () => {
        const noEntity = buildZone({ id: 'zone-noentity', homeAssistantEntityId: undefined });
        let stateCalls = 0;
        const { deps, closes } = buildDeps({
            managedZones: [noEntity],
            state: async (): Promise<ZoneRelayState> => { stateCalls += 1; return 'on'; },
        });

        const summary = await reconcileCycleAndRelayState(deps);

        expect(summary).toMatchObject({ orphansClosed: 0 });
        expect(stateCalls).toBe(0);
        expect(closes).toHaveLength(0);
    });

    it('counts an error when the orphan close itself fails', async () => {
        const orphan = buildZone({ id: 'zone-bad' });
        const { deps } = buildDeps({
            managedZones: [orphan],
            state: async (): Promise<ZoneRelayState> => 'on',
            closeFn: async () => { throw new Error('HA 504'); },
        });

        const summary = await reconcileCycleAndRelayState(deps);

        expect(summary).toMatchObject({ errors: 1, orphansClosed: 0 });
    });
});

describe('reconcileCycleAndRelayState — aggregates', () => {
    it('returns the right counters for a multi-cycle scenario', async () => {
        const future = buildPair({
            cycleId: 'cycle-future',
            startTime: new Date('2026-05-04T11:30:00.000Z'),
            durationMin: 60,
            zone: { id: 'zone-future' },
        });
        const overrun = buildPair({
            cycleId: 'cycle-overrun',
            startTime: new Date('2026-05-04T09:00:00.000Z'),
            durationMin: 30,
            zone: { id: 'zone-overrun' },
        });
        const missed = buildPair({
            cycleId: 'cycle-missed',
            startTime: new Date('2026-05-04T09:00:00.000Z'),
            durationMin: 30,
            zone: { id: 'zone-missed' },
        });
        const orphan = buildZone({ id: 'zone-orphan' });
        const calm = buildZone({ id: 'zone-calm' });

        const stateMap: Record<string, ZoneRelayState> = {
            'zone-future': 'on',
            'zone-overrun': 'on',
            'zone-missed': 'off',
            'zone-orphan': 'on',
            'zone-calm': 'off',
        };

        const { deps } = buildDeps({
            inFlight: [future, overrun, missed],
            managedZones: [future.zone, overrun.zone, missed.zone, orphan, calm],
            state: async (zone) => stateMap[zone.id] ?? 'unknown',
        });

        const summary = await reconcileCycleAndRelayState(deps);

        expect(summary).toEqual({ resumed: 1, forcedClosed: 1, missedClose: 1, orphansClosed: 1, errors: 0 });
    });

    it('returns all-zero counters when nothing is in flight and no managed zones provided', async () => {
        const { deps } = buildDeps({});

        const summary = await reconcileCycleAndRelayState(deps);

        expect(summary).toEqual({ resumed: 0, forcedClosed: 0, missedClose: 0, orphansClosed: 0, errors: 0 });
    });
});

describe('reconcileCycleAndRelayState — alert recording', () => {
    it('records a missed-close alert when the relay is already off past planned close', async () => {
        const pair = buildPair({
            cycleId: 'cycle-missed',
            startTime: new Date('2026-05-04T10:00:00.000Z'),
            durationMin: 30,
        });
        const { deps, alertCalls } = buildDeps({
            inFlight: [pair],
            state: async (): Promise<ZoneRelayState> => 'off',
        });

        await reconcileCycleAndRelayState(deps);

        expect(alertCalls).toHaveLength(1);
        expect(alertCalls[0]).toMatchObject({
            class: 'missed-close',
            tone: 'danger',
            title: 'Missed close',
            zoneId: pair.zone.id,
        });
    });

    it('records a missed-close alert when the relay overran (state on past planned close)', async () => {
        const pair = buildPair({
            cycleId: 'cycle-overrun',
            startTime: new Date('2026-05-04T10:00:00.000Z'),
            durationMin: 30,
        });
        const { deps, alertCalls } = buildDeps({
            inFlight: [pair],
            state: async (): Promise<ZoneRelayState> => 'on',
            closeFn: async () => {},
        });

        await reconcileCycleAndRelayState(deps);

        expect(alertCalls).toHaveLength(1);
        expect(alertCalls[0]).toMatchObject({
            class: 'missed-close',
            tone: 'danger',
            title: 'Missed close',
            zoneId: pair.zone.id,
        });
    });

    it('records a ha-call-failed alert when getZoneState throws for an in-flight cycle', async () => {
        const pair = buildPair({ cycleId: 'cycle-err' });
        const { deps, alertCalls } = buildDeps({
            inFlight: [pair],
            state: async () => { throw new Error('HA timeout'); },
        });

        await reconcileCycleAndRelayState(deps);

        expect(alertCalls).toHaveLength(1);
        expect(alertCalls[0]).toMatchObject({
            class: 'ha-call-failed',
            tone: 'danger',
            title: 'HA state query failed',
            zoneId: pair.zone.id,
        });
    });

    it('records a ha-call-failed alert when the force-close call itself throws', async () => {
        const pair = buildPair({
            cycleId: 'cycle-force-fail',
            startTime: new Date('2026-05-04T10:00:00.000Z'),
            durationMin: 30,
        });
        const { deps, alertCalls } = buildDeps({
            inFlight: [pair],
            state: async (): Promise<ZoneRelayState> => 'on',
            closeFn: async () => { throw new Error('HA 504'); },
        });

        await reconcileCycleAndRelayState(deps);

        expect(alertCalls).toHaveLength(1);
        expect(alertCalls[0]).toMatchObject({
            class: 'ha-call-failed',
            tone: 'danger',
            title: 'HA close failed during reconcile',
            zoneId: pair.zone.id,
        });
    });

    it('records a ha-call-failed alert when the orphan sweep closes an unmanaged-open zone', async () => {
        const orphan = buildZone({ id: 'zone-orphan', name: 'Orphan' });
        const { deps, alertCalls } = buildDeps({
            managedZones: [orphan],
            state: async (): Promise<ZoneRelayState> => 'on',
            closeFn: async () => {},
        });

        await reconcileCycleAndRelayState(deps);

        expect(alertCalls).toHaveLength(1);
        expect(alertCalls[0]).toMatchObject({
            class: 'ha-call-failed',
            title: 'Orphan relay closed',
            zoneId: 'zone-orphan',
        });
    });

    it('records no alerts on a fully clean reconciliation pass', async () => {
        const { deps, alertCalls } = buildDeps({});

        await reconcileCycleAndRelayState(deps);

        expect(alertCalls).toEqual([]);
    });

    it('records a ha-call-failed alert when the defensive sweep getZoneState throws', async () => {
        const sweep = buildZone({ id: 'zone-sweep' });
        const { deps, alertCalls } = buildDeps({
            managedZones: [sweep],
            state: async () => { throw new Error('HA sweep timeout'); },
        });

        await reconcileCycleAndRelayState(deps);

        expect(alertCalls).toHaveLength(1);
        expect(alertCalls[0]).toMatchObject({
            class: 'ha-call-failed',
            tone: 'danger',
            title: 'HA state query failed during sweep',
            zoneId: 'zone-sweep',
        });
    });

    it('records a ha-call-failed alert when the orphan-close call itself throws', async () => {
        const orphan = buildZone({ id: 'zone-bad' });
        const { deps, alertCalls } = buildDeps({
            managedZones: [orphan],
            state: async (): Promise<ZoneRelayState> => 'on',
            closeFn: async () => { throw new Error('HA 504'); },
        });

        await reconcileCycleAndRelayState(deps);

        expect(alertCalls).toHaveLength(1);
        expect(alertCalls[0]).toMatchObject({
            class: 'ha-call-failed',
            tone: 'danger',
            title: 'HA close failed for orphan relay',
            zoneId: 'zone-bad',
        });
    });
});
