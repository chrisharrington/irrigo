import { render, screen } from '@testing-library/react-native';

import { NextRunHero } from '.';
import type { NextRunDto } from '@/api/types/next-run';

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
        render(<NextRunHero nextRun={SCHEDULED_NEXT_RUN} siteTimezone='America/Edmonton' />);

        expect(screen.getByText('10:23 pm')).toBeOnTheScreen();
    });

    it('renders the subtitle of zone order, cycle count, and ends time.', () => {
        render(<NextRunHero nextRun={SCHEDULED_NEXT_RUN} siteTimezone='America/Edmonton' />);

        expect(screen.getByText('North, then South · 10 cycles · ends 5:48 am')).toBeOnTheScreen();
    });

    it('renders the Scheduled badge for the scheduled state.', () => {
        render(<NextRunHero nextRun={SCHEDULED_NEXT_RUN} siteTimezone='America/Edmonton' />);

        expect(screen.getByText('Scheduled')).toBeOnTheScreen();
    });

    it('renders the Firing badge when state is firing.', () => {
        render(<NextRunHero nextRun={{ ...SCHEDULED_NEXT_RUN, state: 'firing' }} siteTimezone='America/Edmonton' />);

        expect(screen.getByText('Firing')).toBeOnTheScreen();
    });

    it('omits the ends-at suffix from the subtitle when endsAt is null.', () => {
        render(
            <NextRunHero
                nextRun={{ ...SCHEDULED_NEXT_RUN, endsAt: null }}
                siteTimezone='America/Edmonton'
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
            />,
        );

        expect(screen.getByText('North · 1 cycle · ends 5:48 am')).toBeOnTheScreen();
    });

    it('renders the embedded compact CycleStrip with the per-zone palette applied.', () => {
        render(<NextRunHero nextRun={SCHEDULED_NEXT_RUN} siteTimezone='America/Edmonton' />);

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
            />,
        );

        expect(screen.queryByLabelText('Irrigation cycle chart')).toBeNull();
        expect(screen.getByText('No zones · 10 cycles · ends 5:48 am')).toBeOnTheScreen();
    });
});
