import { describe, it, expect } from 'bun:test';
import { irrigationCycles } from '@/db/schema';
import type { ZoneRelayState } from '@/data/home-assistant';
import type { Zone } from '@/models';
import type { NotificationContext, NotificationEvent, Notifier } from '@/notifications';
import { reconcileCycleAndRelayState, type ReconcileDb, type ReconcileDeps } from './reconcile';
import type { FutureCyclePair } from './schedules';
import type { ArmCloseOnlyInputs, Clock, TimerHandle, TimerRegistry } from './runtime';

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
        siteTimezone: 'America/Edmonton',
        isEnabled: true,
        homeAssistantEntityId: 'switch.zone_001',
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
    cycleUpdates: CycleUpdate[];
    notifications: RecordedNotification[];
} {
    const closes: Zone[] = [];
    const armCalls: ArmCloseOnlyInputs[] = [];
    const cycleUpdates: CycleUpdate[] = [];
    const notifications: RecordedNotification[] = [];
    const now = overrides.now ?? NOW;

    const db: ReconcileDb = {
        select: (() => ({ from: () => ({}) })) as never,
        update(table) {
            return {
                set(values) {
                    return {
                        async where(cond) {
                            if (table !== irrigationCycles) return;
                            const cycleId = extractIdFromEq(cond);
                            const closedAt = values['closedAt'];
                            if (closedAt instanceof Date) {
                                cycleUpdates.push({ cycleId, closedAt });
                            }
                        },
                    };
                },
            };
        },
    };

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

    return {
        closes,
        armCalls,
        cycleUpdates,
        notifications,
        deps: {
            db,
            clock: fakeClock(now),
            registry,
            notifier,
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

function extractIdFromEq(cond: unknown): string {
    const seen = new WeakSet<object>();
    function walk(node: unknown): string | undefined {
        if (typeof node === 'string') return /^cycle-/.test(node) ? node : undefined;
        if (typeof node !== 'object' || node === null) return undefined;
        if (seen.has(node)) return undefined;
        seen.add(node);
        if (Array.isArray(node)) {
            for (const item of node) {
                const found = walk(item);
                if (found) return found;
            }
            return undefined;
        }
        for (const value of Object.values(node)) {
            const found = walk(value);
            if (found) return found;
        }
        return undefined;
    }
    return walk(cond) ?? '';
}

describe('reconcileCycleAndRelayState — in-flight cycle handling', () => {
    it(`re-arms the close timer when HA is 'on' and planned close is in the future`, async () => {
        const pair = buildPair({
            cycleId: 'cycle-future',
            startTime: new Date('2026-05-04T11:30:00.000Z'),
            durationMin: 60, // closes at 12:30, after now=12:00
        });
        const sweep = buildZone({ id: 'zone-sweep' });
        const { deps, armCalls, closes, cycleUpdates } = buildDeps({
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
            durationMin: 30, // closes at 10:30, well before now=12:00
        });
        const { deps, closes, cycleUpdates, notifications } = buildDeps({
            inFlight: [pair],
            state: async (): Promise<ZoneRelayState> => 'on',
        });

        const summary = await reconcileCycleAndRelayState(deps);

        expect(summary).toMatchObject({ resumed: 0, forcedClosed: 1, missedClose: 0, orphansClosed: 0 });
        expect(closes).toHaveLength(1);
        expect(cycleUpdates).toEqual([{ cycleId: 'cycle-overrun', closedAt: NOW }]);
        const overrunNote = notifications.find(n => n.context?.operation === 'reconcile-overrun');
        expect(overrunNote).toBeDefined();
    });

    it(`records closed_at = plannedCloseAt when HA is 'off' and the planned close is earlier than now`, async () => {
        const pair = buildPair({
            cycleId: 'cycle-missed',
            startTime: new Date('2026-05-04T10:00:00.000Z'),
            durationMin: 30,
        });
        const { deps, cycleUpdates, closes } = buildDeps({
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
            durationMin: 60, // closes at 12:30, after now=12:00
        });
        const { deps, cycleUpdates } = buildDeps({
            inFlight: [pair],
            state: async (): Promise<ZoneRelayState> => 'off',
        });

        await reconcileCycleAndRelayState(deps);

        expect(cycleUpdates).toEqual([{ cycleId: 'cycle-missed-early', closedAt: NOW }]);
    });

    it(`leaves the cycle alone when HA returns 'unknown' and does not mark the zone handled`, async () => {
        const pair = buildPair({ cycleId: 'cycle-unknown' });
        const { deps, cycleUpdates, closes, armCalls } = buildDeps({
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
        const { deps, cycleUpdates, closes, notifications } = buildDeps({
            inFlight: [pair],
            state: async () => { throw new Error('HA timeout'); },
        });

        const summary = await reconcileCycleAndRelayState(deps);

        expect(summary).toMatchObject({ errors: 1 });
        expect(cycleUpdates).toHaveLength(0);
        expect(closes).toHaveLength(0);
        const errNote = notifications.find(n => n.context?.operation === 'reconcile-state');
        expect(errNote?.context?.reason).toBe('HA timeout');
    });
});

describe('reconcileCycleAndRelayState — defensive sweep', () => {
    it(`force-closes a managed zone HA reports 'on' with no in-flight cycle`, async () => {
        const orphan = buildZone({ id: 'zone-orphan', name: 'Orphan' });
        const { deps, closes, notifications } = buildDeps({
            managedZones: [orphan],
            state: async (): Promise<ZoneRelayState> => 'on',
        });

        const summary = await reconcileCycleAndRelayState(deps);

        expect(summary).toMatchObject({ orphansClosed: 1 });
        expect(closes).toEqual([orphan]);
        const orphanNote = notifications.find(n => n.context?.operation === 'reconcile-orphan-close');
        expect(orphanNote?.context?.zoneName).toBe('Orphan');
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
            // State is 'on' for both — without skipping, we'd call closeZone in the sweep too.
            state: async (): Promise<ZoneRelayState> => 'off',
        });

        const summary = await reconcileCycleAndRelayState(deps);

        // The cycle path takes care of the missed close; the sweep does NOT then act on it.
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
        const { deps, notifications } = buildDeps({
            managedZones: [orphan],
            state: async (): Promise<ZoneRelayState> => 'on',
            closeFn: async () => { throw new Error('HA 504'); },
        });

        const summary = await reconcileCycleAndRelayState(deps);

        expect(summary).toMatchObject({ errors: 1, orphansClosed: 0 });
        const errNote = notifications.find(n => n.context?.operation === 'reconcile-orphan-close' && n.context?.reason === 'HA 504');
        expect(errNote).toBeDefined();
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
