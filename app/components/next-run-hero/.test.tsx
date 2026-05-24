import { render, screen } from '@testing-library/react-native';

import { NextRunHero } from '.';
import type { NextRunDto } from '@/api/types/next-run';

// 2026-05-23T20:00:00Z = 14:00 MDT on 2026-05-23 (Saturday) — same local day as
// SCHEDULED_NEXT_RUN.startTime (22:23 MDT, also 2026-05-23).
const NOW_LOCAL_SAME_DAY = new Date('2026-05-23T20:00:00.000Z');

const SCHEDULED_NEXT_RUN: NextRunDto = {
    state: 'scheduled',
    // 2026-05-24T04:23Z = 22:23 MDT on 2026-05-23.
    startTime: '2026-05-24T04:23:00.000Z',
    // 2026-05-24T11:48Z = 05:48 MDT.
    endsAt: '2026-05-24T11:48:00.000Z',
    axisStart: '22:00',
    axisEnd: '06:00',
    sunset: '20:45',
    sunrise: '05:30',
    zoneOrder: ['North', 'South'],
    totalCycles: 10,
    zones: [
        { name: 'North', slug: 'north', patch: 'a', cycles: [{ start: '22:23', durMin: 15 }] },
        { name: 'South', slug: 'south', patch: 'b', cycles: [{ start: '23:00', durMin: 12 }] },
    ],
};

const IDLE_NEXT_RUN: NextRunDto = {
    state: 'idle',
    startTime: null,
    endsAt: null,
    axisStart: null,
    axisEnd: null,
    sunset: null,
    sunrise: null,
    zoneOrder: [],
    totalCycles: 0,
    zones: [],
};

describe('NextRunHero', () => {
    it('renders the empty-state card when the system is idle.', () => {
        render(<NextRunHero nextRun={IDLE_NEXT_RUN} />);

        expect(screen.getByLabelText('No runs queued')).toBeOnTheScreen();
        expect(screen.getByText('No runs queued.')).toBeOnTheScreen();
        expect(screen.getByText('All zones are within tolerance.')).toBeOnTheScreen();
    });

    it('shows the rain-skip subtitle when state is skipped-rain.', () => {
        render(<NextRunHero nextRun={{ ...IDLE_NEXT_RUN, state: 'skipped-rain' }} />);

        expect(screen.getByText('Skipped tonight — rain forecast.')).toBeOnTheScreen();
    });

    it('renders the next-run time in the supplied site timezone (12h with am/pm).', () => {
        render(
            <NextRunHero
                nextRun={SCHEDULED_NEXT_RUN}
                siteTimezone='America/Edmonton'
                now={NOW_LOCAL_SAME_DAY}
            />,
        );

        expect(screen.getByText('10:23 pm')).toBeOnTheScreen();
    });

    it('renders the subtitle without a date prefix when the run is today.', () => {
        render(
            <NextRunHero
                nextRun={SCHEDULED_NEXT_RUN}
                siteTimezone='America/Edmonton'
                now={NOW_LOCAL_SAME_DAY}
            />,
        );

        expect(screen.getByText('North, then South · 10 cycles · ends 5:48 am')).toBeOnTheScreen();
    });

    it('prepends "Tomorrow" to the subtitle when the run is the next local calendar day.', () => {
        // NOW is one full local day before SCHEDULED_NEXT_RUN.startTime (2026-05-23 MDT).
        const nowDayBefore = new Date('2026-05-22T20:00:00.000Z');
        render(
            <NextRunHero
                nextRun={SCHEDULED_NEXT_RUN}
                siteTimezone='America/Edmonton'
                now={nowDayBefore}
            />,
        );

        expect(screen.getByText('Tomorrow · North, then South · 10 cycles · ends 5:48 am')).toBeOnTheScreen();
    });

    it('prepends the short weekday for runs 2–6 local days out.', () => {
        // NOW is three local days before SCHEDULED_NEXT_RUN.startTime (2026-05-23 MDT = Saturday).
        const nowThreeDaysBefore = new Date('2026-05-20T20:00:00.000Z');
        render(
            <NextRunHero
                nextRun={SCHEDULED_NEXT_RUN}
                siteTimezone='America/Edmonton'
                now={nowThreeDaysBefore}
            />,
        );

        expect(screen.getByText('Sat · North, then South · 10 cycles · ends 5:48 am')).toBeOnTheScreen();
    });

    it('prepends the long "Ddd D MMM" form for runs 7+ local days out.', () => {
        // NOW is ten local days before SCHEDULED_NEXT_RUN.startTime (2026-05-23 MDT = Saturday 23 May).
        const nowTenDaysBefore = new Date('2026-05-13T20:00:00.000Z');
        render(
            <NextRunHero
                nextRun={SCHEDULED_NEXT_RUN}
                siteTimezone='America/Edmonton'
                now={nowTenDaysBefore}
            />,
        );

        expect(screen.getByText('Sat 23 May · North, then South · 10 cycles · ends 5:48 am')).toBeOnTheScreen();
    });

    it('renders the Scheduled badge for the scheduled state.', () => {
        render(
            <NextRunHero
                nextRun={SCHEDULED_NEXT_RUN}
                siteTimezone='America/Edmonton'
                now={NOW_LOCAL_SAME_DAY}
            />,
        );

        expect(screen.getByText('Scheduled')).toBeOnTheScreen();
    });

    it('renders the Firing badge when state is firing.', () => {
        render(
            <NextRunHero
                nextRun={{ ...SCHEDULED_NEXT_RUN, state: 'firing' }}
                siteTimezone='America/Edmonton'
                now={NOW_LOCAL_SAME_DAY}
            />,
        );

        expect(screen.getByText('Firing')).toBeOnTheScreen();
    });

    it('omits the ends-at suffix from the subtitle when endsAt is null.', () => {
        render(
            <NextRunHero
                nextRun={{ ...SCHEDULED_NEXT_RUN, endsAt: null }}
                siteTimezone='America/Edmonton'
                now={NOW_LOCAL_SAME_DAY}
            />,
        );

        expect(screen.getByText('North, then South · 10 cycles')).toBeOnTheScreen();
        expect(screen.queryByText(/ends/)).toBeNull();
    });

    it('switches to the singular `cycle` label when totalCycles is 1.', () => {
        render(
            <NextRunHero
                nextRun={{ ...SCHEDULED_NEXT_RUN, totalCycles: 1, zoneOrder: ['North'] }}
                siteTimezone='America/Edmonton'
                now={NOW_LOCAL_SAME_DAY}
            />,
        );

        expect(screen.getByText('North · 1 cycle · ends 5:48 am')).toBeOnTheScreen();
    });

    it('renders one schedule line per zone, in run order, with am/pm windows.', () => {
        render(
            <NextRunHero
                nextRun={SCHEDULED_NEXT_RUN}
                siteTimezone='America/Edmonton'
                now={NOW_LOCAL_SAME_DAY}
            />,
        );

        // North fires at 22:23 for 15 min → 10:23 pm to 10:38 pm.
        expect(screen.getByText('North zone: 10:23 pm to 10:38 pm')).toBeOnTheScreen();
        // South fires at 23:00 for 12 min → 11:00 pm to 11:12 pm.
        expect(screen.getByText('South zone: 11:00 pm to 11:12 pm')).toBeOnTheScreen();
    });

    it('joins multiple cycles on the same zone with `, `.', () => {
        render(
            <NextRunHero
                nextRun={{
                    ...SCHEDULED_NEXT_RUN,
                    zones: [
                        {
                            name: 'North',
                            slug: 'north',
                            patch: 'a',
                            cycles: [
                                { start: '22:23', durMin: 15 },
                                { start: '23:40', durMin: 18 },
                            ],
                        },
                    ],
                    zoneOrder: ['North'],
                    totalCycles: 2,
                }}
                siteTimezone='America/Edmonton'
                now={NOW_LOCAL_SAME_DAY}
            />,
        );

        expect(
            screen.getByText('North zone: 10:23 pm to 10:38 pm, 11:40 pm to 11:58 pm'),
        ).toBeOnTheScreen();
    });

    it('omits the schedule list when zones is empty (active state, no plan yet).', () => {
        render(
            <NextRunHero
                nextRun={{ ...SCHEDULED_NEXT_RUN, zones: [], zoneOrder: [] }}
                siteTimezone='America/Edmonton'
                now={NOW_LOCAL_SAME_DAY}
            />,
        );

        expect(screen.queryByText(/zone:/)).toBeNull();
        expect(screen.getByText('No zones · 10 cycles · ends 5:48 am')).toBeOnTheScreen();
    });
});
