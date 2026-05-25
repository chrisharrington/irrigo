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
    timezone: 'America/Edmonton',
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
    timezone: 'America/Edmonton',
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

    it(`renders the date label as 'Today, D MMM' when the run is today.`, () => {
        render(
            <NextRunHero
                nextRun={SCHEDULED_NEXT_RUN}
                siteTimezone='America/Edmonton'
                now={NOW_LOCAL_SAME_DAY}
            />,
        );

        expect(screen.getByText('Today, 23 May')).toBeOnTheScreen();
    });

    it(`renders the date label as 'Tomorrow, D MMM' when the run is the next local calendar day.`, () => {
        // NOW is one full local day before SCHEDULED_NEXT_RUN.startTime (2026-05-23 MDT).
        const nowDayBefore = new Date('2026-05-22T20:00:00.000Z');
        render(
            <NextRunHero
                nextRun={SCHEDULED_NEXT_RUN}
                siteTimezone='America/Edmonton'
                now={nowDayBefore}
            />,
        );

        expect(screen.getByText('Tomorrow, 23 May')).toBeOnTheScreen();
    });

    it(`renders the date label as 'Ddd, D MMM' for runs 2+ local days out.`, () => {
        // NOW is three local days before SCHEDULED_NEXT_RUN.startTime (2026-05-23 MDT = Saturday).
        const nowThreeDaysBefore = new Date('2026-05-20T20:00:00.000Z');
        render(
            <NextRunHero
                nextRun={SCHEDULED_NEXT_RUN}
                siteTimezone='America/Edmonton'
                now={nowThreeDaysBefore}
            />,
        );

        expect(screen.getByText('Sat, 23 May')).toBeOnTheScreen();
    });

    it(`renders the same 'Ddd, D MMM' format for far-future runs (7+ local days out).`, () => {
        // NOW is ten local days before SCHEDULED_NEXT_RUN.startTime (2026-05-23 MDT = Saturday 23 May).
        const nowTenDaysBefore = new Date('2026-05-13T20:00:00.000Z');
        render(
            <NextRunHero
                nextRun={SCHEDULED_NEXT_RUN}
                siteTimezone='America/Edmonton'
                now={nowTenDaysBefore}
            />,
        );

        expect(screen.getByText('Sat, 23 May')).toBeOnTheScreen();
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

    it('does not render a badge when state is firing (APP-43).', () => {
        render(
            <NextRunHero
                nextRun={{ ...SCHEDULED_NEXT_RUN, state: 'firing' }}
                siteTimezone='America/Edmonton'
                now={NOW_LOCAL_SAME_DAY}
            />,
        );

        // The body of the card still renders — just the badge is suppressed.
        expect(screen.getByText('10:23 pm')).toBeOnTheScreen();
        // None of the badge labels appear.
        expect(screen.queryByText('Firing')).toBeNull();
        expect(screen.queryByText('Scheduled')).toBeNull();
        expect(screen.queryByText('Skipped rain')).toBeNull();
        expect(screen.queryByText('Skipped')).toBeNull();
        expect(screen.queryByText('Idle')).toBeNull();
    });

    it('renders the embedded compact CycleStrip with the per-zone palette applied.', () => {
        render(
            <NextRunHero
                nextRun={SCHEDULED_NEXT_RUN}
                siteTimezone='America/Edmonton'
                now={NOW_LOCAL_SAME_DAY}
            />,
        );

        // The CycleStrip exposes a stable accessibility label that the
        // hero embeds verbatim — its presence proves the strip mounted.
        expect(screen.getByLabelText('Irrigation cycle chart')).toBeOnTheScreen();
        // Both zones appear in the strip's legend.
        expect(screen.getByLabelText('North: 1 cycles, 15 minutes')).toBeOnTheScreen();
        expect(screen.getByLabelText('South: 1 cycles, 12 minutes')).toBeOnTheScreen();
    });

    it('does not render the cycle strip when zones is empty (active state, no plan yet).', () => {
        render(
            <NextRunHero
                nextRun={{ ...SCHEDULED_NEXT_RUN, zones: [], zoneOrder: [] }}
                siteTimezone='America/Edmonton'
                now={NOW_LOCAL_SAME_DAY}
            />,
        );

        expect(screen.queryByLabelText('Irrigation cycle chart')).toBeNull();
        // The date label still renders — it doesn't depend on zones.
        expect(screen.getByText('Today, 23 May')).toBeOnTheScreen();
    });
});
