import type { Alerter } from '@/alerts';
import type { ZoneRelayState } from '@/data/home-assistant';
import type { WeatherData, Zone } from '@/models';
import type { CategoryPushNotifier } from '@/service/push-tokens';
import type { ScheduleEntriesRepository } from '@/repositories/schedule-entries';
import type { ZonesRepository } from '@/repositories/zones';
import { getSystemState } from '@/service/system';
import { reconcileCycleAndRelayState, type ReconcileSummary } from '../reconcile';
import { armCloseOnly, armCycle, type Clock, type TimerRegistry } from '../runtime';
import { pickUpcomingSunrise } from '../scheduling';

/**
 * Dependencies consumed by `runBootSequence`. Pulled into a single object
 * so the boot orchestration has one parameter for collaborators.
 */
export type BootDeps = {
    clock: Clock;
    registry: TimerRegistry;
    /** Gated Expo push for lifecycle notifications, passed through to reconcile + armCycle. */
    pushNotify?: CategoryPushNotifier;
    alerter: Alerter;
    openZone: (zone: Zone) => Promise<void>;
    closeZone: (zone: Zone) => Promise<void>;
    getZoneState: (zone: Zone) => Promise<ZoneRelayState>;
    getWeather: (zone: Zone) => Promise<WeatherData>;
    zonesRepo: ZonesRepository;
    scheduleEntriesRepo: ScheduleEntriesRepository;
};

export type RunBootSequenceInput = {
    morningTickMinutesAfterSunrise: number;
    deps: BootDeps;
};

export type RunBootSequenceResult = {
    /**
     * Sunrise instant to seed the morning-tick scheduler with. `null` when
     * no boot weather fetch succeeded — `scheduleNextTick` will fall back to
     * evening-only until the first in-tick fetch refreshes the anchor.
     */
    initialSunrise: Date | null;
    enabledZonesAtBoot: Zone[];
    reconcileSummary: ReconcileSummary;
};

/**
 * Runs the daemon's boot sequence: relay/cycle reconciliation, future-cycle
 * arming (gated by the kill switch), zone-count warnings, and the boot
 * weather fetch that seeds the morning-tick anchor. Caller-owned mutable
 * state (`latestKnownSunrise`) is updated from `initialSunrise` after this
 * returns.
 *
 * Each side-effect is the same as the previous inline implementation in
 * `start()`; this function just packages them so the boot path becomes one
 * call instead of ~60 lines of imperative setup.
 */
export async function runBootSequence(input: RunBootSequenceInput): Promise<RunBootSequenceResult> {
    const { morningTickMinutesAfterSunrise, deps } = input;
    const { clock, registry, pushNotify, alerter, openZone, closeZone, getZoneState, getWeather, zonesRepo, scheduleEntriesRepo } = deps;

    const enabledZonesAtBoot = await zonesRepo.loadEnabled();
    const reconcileSummary = await reconcileCycleAndRelayState({
        clock,
        registry,
        pushNotify,
        alerter,
        closeZone,
        getZoneState,
        armCloseOnly,
        managedZones: enabledZonesAtBoot.filter(z => z.homeAssistantEntityId !== undefined),
    });
    console.log(`daemon: reconcile summary — resumed: ${reconcileSummary.resumed}, forcedClosed: ${reconcileSummary.forcedClosed}, missedClose: ${reconcileSummary.missedClose}, orphansClosed: ${reconcileSummary.orphansClosed}, errors: ${reconcileSummary.errors}.`);

    const futureCycles = await scheduleEntriesRepo.loadFutureCycles(clock.now());
    const systemAtBoot = await getSystemState();
    if (!systemAtBoot.irrigationEnabled) {
        console.warn(`daemon: system irrigation is disabled (since ${systemAtBoot.since}); skipping arm of ${futureCycles.length} future cycle(s).`);
    } else {
        for (const { cycle, zone } of futureCycles) {
            armCycle({ clock, registry, zone, cycle, openZone, closeZone, pushNotify, alerter });
        }
    }

    const { total, enabled } = await zonesRepo.count();
    if (total === 0) {
        console.warn('daemon: has no zones to manage. Did you run `bun run seed`? Daemon is idle until zones are added.');
    } else if (enabled === 0) {
        console.warn('daemon: all zones are disabled. Daemon is idle until at least one zone is enabled.');
    }

    // Boot weather fetch — seeds latestKnownSunrise so the first
    // scheduleNextTick can pick a morning tick. Fire-and-forget tolerance:
    // if the fetch fails, the daemon still boots and schedules an evening
    // tick; the next successful fetch (per-zone, inside _rePlan) repopulates
    // the anchor.
    let initialSunrise: Date | null = null;
    const bootSeedZone = enabledZonesAtBoot.find(z => z.location !== undefined);
    if (bootSeedZone) {
        try {
            const bootWeather = await getWeather(bootSeedZone);
            initialSunrise = pickUpcomingSunrise(bootWeather.daily, clock.now(), morningTickMinutesAfterSunrise);
            console.log(`daemon: boot weather fetch ok — latestKnownSunrise=${initialSunrise?.toISOString() ?? 'null'}.`);
        } catch (err) {
            console.warn(`daemon: boot weather fetch failed; morning tick will be scheduled after the first successful in-tick fetch.`, err);
        }
    }

    return { initialSunrise, enabledZonesAtBoot, reconcileSummary };
}
