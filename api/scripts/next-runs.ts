import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { and, eq, gte, isNull } from 'drizzle-orm';
import { irrigationCycles, scheduleEntries, sites, zones } from '@/db/schema';

dayjs.extend(utc);
dayjs.extend(timezone);

const NEXT_RUNS_LIMIT = 5;
const ZONE_COL_WIDTH = 30;
const TIME_COL_WIDTH = 25; // 'YYYY-MM-DDTHH:mm:ss±HH:mm' is always 25 chars

export type NextRun = {
    zoneName: string;
    zoneSlug: string;
    startTime: Date;
    endTime: Date;
    siteTimezone: string;
};

export type NextRunsCliDeps = {
    loadRuns: (now: Date, limit: number) => Promise<NextRun[]>;
    log: (message: string) => void;
    error: (message: string) => void;
};

export async function nextRunsCli(deps: NextRunsCliDeps): Promise<0 | 1> {
    let runs: NextRun[];
    try {
        runs = await deps.loadRuns(new Date(), NEXT_RUNS_LIMIT);
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
    const startFmt = dayjs(run.startTime).tz(run.siteTimezone).format('YYYY-MM-DDTHH:mm:ssZ');
    const endFmt = dayjs(run.endTime).tz(run.siteTimezone).format('YYYY-MM-DDTHH:mm:ssZ');
    return (
        run.zoneName.padEnd(ZONE_COL_WIDTH) + '  ' +
        startFmt.padEnd(TIME_COL_WIDTH) + '  ' +
        endFmt
    );
}

if (import.meta.main) {
    const deps: NextRunsCliDeps = {
        loadRuns: async (now, limit) => {
            const { db } = await import('@/db');

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
                .slice(0, limit)
                .map(row => ({
                    zoneName: row.zoneName,
                    zoneSlug: row.zoneSlug,
                    startTime: row.startTime,
                    endTime: new Date(row.startTime.getTime() + row.durationMin * 60_000),
                    siteTimezone: row.siteTimezone,
                }));
        },
        log: m => console.log(m),
        error: m => console.error(m),
    };
    nextRunsCli(deps).then(code => process.exit(code));
}
