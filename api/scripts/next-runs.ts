import dayjs from '@/util/dayjs';
import { and, eq, gte, isNull } from 'drizzle-orm';
import { irrigationCycles, scheduleEntries, sites, zones } from '@/db/schema';
import type { db as DbType } from '@/db';

const ZONE_COL_WIDTH = 30;
const TIME_COL_WIDTH = 26;

export type NextRun = {
    zoneName: string;
    zoneSlug: string;
    startTime: Date;
    endTime: Date;
    siteTimezone: string;
};

export type NextRunsCliDeps = {
    loadRuns: (now: Date) => Promise<NextRun[]>;
    log: (message: string) => void;
    error: (message: string) => void;
};

export async function nextRunsCli(deps: NextRunsCliDeps): Promise<0 | 1> {
    let runs: NextRun[];
    try {
        runs = await deps.loadRuns(new Date());
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        deps.error(`next-runs: failed to load upcoming cycles — ${message}`);
        return 1;
    }

    if (runs.length === 0) {
        deps.log('next-runs: no upcoming scheduled irrigation cycles.');
        return 0;
    }

    deps.log(formatHeader());
    for (const run of runs) {
        deps.log(formatRun(run));
    }
    return 0;
}

function formatHeader(): string {
    return (
        'Zone'.padEnd(ZONE_COL_WIDTH) + '  ' +
        'Start'.padEnd(TIME_COL_WIDTH) + '  ' +
        'End'
    );
}

function formatRun(run: NextRun): string {
    const fmt = (d: Date) => dayjs(d).tz(run.siteTimezone).format('ddd MMM D, YYYY h:mma');
    return (
        run.zoneName.padEnd(ZONE_COL_WIDTH) + '  ' +
        fmt(run.startTime).padEnd(TIME_COL_WIDTH) + '  ' +
        fmt(run.endTime)
    );
}

export async function loadNextRuns(db: typeof DbType, now: Date): Promise<NextRun[]> {
    const rows = await db
        .select({
            startTime: irrigationCycles.startTime,
            durationMin: irrigationCycles.durationMin,
            zoneName: zones.name,
            zoneSlug: zones.slug,
            siteTimezone: sites.timezone,
        })
        .from(irrigationCycles)
        .innerJoin(scheduleEntries, eq(irrigationCycles.scheduleEntryId, scheduleEntries.id))
        .innerJoin(zones, eq(scheduleEntries.zoneId, zones.id))
        .innerJoin(sites, eq(zones.siteId, sites.id))
        .where(
            and(
                isNull(irrigationCycles.firedAt),
                gte(irrigationCycles.startTime, now),
                eq(zones.isEnabled, true),
            ),
        );

    return rows
        .sort((a, b) => {
            const diff = a.startTime.getTime() - b.startTime.getTime();
            return diff !== 0 ? diff : a.zoneSlug.localeCompare(b.zoneSlug);
        })
        .map(row => ({
            zoneName: row.zoneName,
            zoneSlug: row.zoneSlug,
            startTime: row.startTime,
            endTime: new Date(row.startTime.getTime() + row.durationMin * 60_000),
            siteTimezone: row.siteTimezone,
        }));
}

if (import.meta.main) {
    const { db } = await import('@/db');
    const deps: NextRunsCliDeps = {
        loadRuns: (now) => loadNextRuns(db, now),
        log: m => console.log(m),
        error: m => console.error(m),
    };
    nextRunsCli(deps).then(code => process.exit(code));
}
