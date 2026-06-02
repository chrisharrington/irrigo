import { fireEvent, render, screen } from '@testing-library/react-native';

import type { ActivityDto } from '@/api/types/activity';
import type { NextRunDto } from '@/api/types/next-run';
import type { ZoneSummary } from '@/api/types/zones';
import { ZoneDetail } from '.';

function buildZone(overrides?: Partial<ZoneSummary>): ZoneSummary {
    return {
        id: 'z-1',
        slug: 'north',
        name: 'North',
        isEnabled: true,
        grassType: { name: 'Kentucky Bluegrass' },
        soilType: { name: 'Loam' },
        areaM2: 100,
        rootDepthM: 0.3,
        allowableDepletionFraction: 0.5,
        irrigationEfficiency: 0.8,
        microclimateFactor: 1.05,
        precipitationRateMmPerHr: 14,
        currentDepletionMm: 5,
        rawMm: 22.5,
        lastFiredAt: null,
        lastAppliedMm: null,
        homeAssistantEntityId: 'switch.north_zone',
        patch: 'a',
        isRunning: false,
        willCloseAt: null,
        ...overrides,
    };
}

function buildActivity(overrides?: Partial<ActivityDto>): ActivityDto {
    return {
        id: 'act-1',
        date: '2026-05-03T05:00:00.000Z',
        zone: { id: 'z-1', name: 'North', slug: 'north' },
        appliedDepthMm: 9,
        durationMin: 30,
        startedAt: null,
        depletionBeforeMm: 22,
        depletionAfterMm: 0,
        source: 'planner',
        ...overrides,
    };
}

function buildNextRun(): NextRunDto {
    return {
        state: 'scheduled',
        startTime: '2026-05-04T05:00:00.000Z',
        endsAt: '2026-05-04T07:00:00.000Z',
        axisStart: '04:00',
        axisEnd: '08:00',
        sunset: '20:30',
        sunrise: '05:30',
        timezone: 'America/Edmonton',
        zoneOrder: ['north'],
        totalCycles: 1,
        zones: [
            { name: 'North', slug: 'north', patch: 'a', cycles: [{ start: '05:00', durMin: 15 }] },
        ],
    };
}

describe('ZoneDetail', () => {
    it('renders the zone name, grass + area eyebrow, and depletion mm figure.', () => {
        render(
            <ZoneDetail
                zone={buildZone({ currentDepletionMm: 27.4 })}
                nextRun={undefined}
                activity={[]}
                isActivityLoading={false}
                onRunNow={jest.fn()}
                onStopWatering={jest.fn()}
            />,
        );

        expect(screen.getByText('North')).toBeOnTheScreen();
        expect(screen.getByText('Kentucky Bluegrass · 100 m²')).toBeOnTheScreen();
        expect(screen.getByText('27.4')).toBeOnTheScreen();
        expect(screen.getByText('mm')).toBeOnTheScreen();
    });

    it('renders all physical attribute rows.', () => {
        render(
            <ZoneDetail
                zone={buildZone()}
                nextRun={undefined}
                activity={[]}
                isActivityLoading={false}
                onRunNow={jest.fn()}
                onStopWatering={jest.fn()}
            />,
        );

        expect(screen.getByText('Grass type')).toBeOnTheScreen();
        expect(screen.getByText('Area')).toBeOnTheScreen();
        expect(screen.getByText('100 m²')).toBeOnTheScreen();
        expect(screen.getByText('Root depth')).toBeOnTheScreen();
        expect(screen.getByText('0.30 m')).toBeOnTheScreen();
        expect(screen.getByText('Allowable depletion')).toBeOnTheScreen();
        expect(screen.getByText('0.50')).toBeOnTheScreen();
        expect(screen.getByText('Soil')).toBeOnTheScreen();
        expect(screen.getByText('Loam')).toBeOnTheScreen();
        expect(screen.getByText('Precipitation rate')).toBeOnTheScreen();
        expect(screen.getByText('14.0 mm/hr')).toBeOnTheScreen();
        expect(screen.getByText('Microclimate factor')).toBeOnTheScreen();
        expect(screen.getByText('1.05')).toBeOnTheScreen();
        expect(screen.getByText('Entity')).toBeOnTheScreen();
        expect(screen.getByText('switch.north_zone')).toBeOnTheScreen();
    });

    it('renders "—" for precipitation rate and entity when they are null.', () => {
        render(
            <ZoneDetail
                zone={buildZone({ precipitationRateMmPerHr: null, homeAssistantEntityId: null })}
                nextRun={undefined}
                activity={[]}
                isActivityLoading={false}
                onRunNow={jest.fn()}
                onStopWatering={jest.fn()}
            />,
        );

        // Two — placeholders (one for each null field).
        expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
    });

    it('renders the tone copy without qualifier when no nextRun is supplied.', () => {
        render(
            <ZoneDetail
                zone={buildZone({ currentDepletionMm: 27.4, rawMm: 22.5 })}
                nextRun={undefined}
                activity={[]}
                isActivityLoading={false}
                onRunNow={jest.fn()}
                onStopWatering={jest.fn()}
            />,
        );

        expect(screen.getByText('Past RAW')).toBeOnTheScreen();
    });

    it('appends the next-run start time to the tone copy when nextRun has cycles for the zone.', () => {
        render(
            <ZoneDetail
                zone={buildZone({ currentDepletionMm: 27.4, rawMm: 22.5 })}
                nextRun={buildNextRun()}
                activity={[]}
                isActivityLoading={false}
                onRunNow={jest.fn()}
                onStopWatering={jest.fn()}
            />,
        );

        expect(screen.getByText('Past RAW · next run at 05:00')).toBeOnTheScreen();
    });

    it('renders the recent-runs rows from the supplied activity.', () => {
        // 2026-05-03T15:00Z = 09:00 MDT on May 3; 2026-05-02T15:00Z = 09:00 MDT on May 2.
        const activity = [
            buildActivity({ id: 'a-1', date: '2026-05-03', startedAt: '2026-05-03T15:00:00.000Z', appliedDepthMm: 9, durationMin: 30, depletionBeforeMm: 22, depletionAfterMm: 0 }),
            buildActivity({ id: 'a-2', date: '2026-05-02', startedAt: '2026-05-02T15:00:00.000Z', appliedDepthMm: 4.5, durationMin: 15, depletionBeforeMm: 13, depletionAfterMm: 0 }),
        ];

        render(
            <ZoneDetail
                zone={buildZone()}
                nextRun={undefined}
                activity={activity}
                isActivityLoading={false}
                onRunNow={jest.fn()}
                onStopWatering={jest.fn()}
            />,
        );

        expect(screen.getByText('May 3 · 09:00')).toBeOnTheScreen();
        expect(screen.getByText('9.0 mm · 30 min')).toBeOnTheScreen();
        expect(screen.getByText('22.0 → 0.0 mm')).toBeOnTheScreen();
        expect(screen.getByText('May 2 · 09:00')).toBeOnTheScreen();
        expect(screen.getByText('4.5 mm · 15 min')).toBeOnTheScreen();
        expect(screen.getByText('13.0 → 0.0 mm')).toBeOnTheScreen();
    });

    it('formats recent-run dates in the supplied site timezone from startedAt (APP-71 / APP-78).', () => {
        // 2026-05-14T05:30Z = 23:30 MDT on 2026-05-13 — still May 13 locally,
        // and the time should read 23:30 site-local. The `date` field
        // says May 14 (planner's scheduled-night bucket); the formatter
        // prefers `startedAt` and shows the actual local day.
        const activity = [
            buildActivity({ id: 'a-1', date: '2026-05-14', startedAt: '2026-05-14T05:30:00.000Z' }),
        ];

        render(
            <ZoneDetail
                zone={buildZone()}
                nextRun={undefined}
                activity={activity}
                isActivityLoading={false}
                onRunNow={jest.fn()}
                onStopWatering={jest.fn()}
            />,
        );

        expect(screen.getByText('May 13 · 23:30')).toBeOnTheScreen();
    });

    it('falls back to date-only `MMM D` on recent-run rows when startedAt is null (APP-78).', () => {
        const activity = [
            buildActivity({ id: 'a-1', date: '2026-05-13', startedAt: null }),
        ];

        render(
            <ZoneDetail
                zone={buildZone()}
                nextRun={undefined}
                activity={activity}
                isActivityLoading={false}
                onRunNow={jest.fn()}
                onStopWatering={jest.fn()}
            />,
        );

        expect(screen.getByText('May 13')).toBeOnTheScreen();
    });

    it('renders an empty state when activity is empty and not loading.', () => {
        render(
            <ZoneDetail
                zone={buildZone()}
                nextRun={undefined}
                activity={[]}
                isActivityLoading={false}
                onRunNow={jest.fn()}
                onStopWatering={jest.fn()}
            />,
        );

        expect(screen.getByText('No runs recorded yet.')).toBeOnTheScreen();
    });

    it('renders a loading hint when activity is empty and isActivityLoading is true.', () => {
        render(
            <ZoneDetail
                zone={buildZone()}
                nextRun={undefined}
                activity={[]}
                isActivityLoading
                onRunNow={jest.fn()}
                onStopWatering={jest.fn()}
            />,
        );

        expect(screen.getByText('Loading recent runs…')).toBeOnTheScreen();
    });

    it('fires onRunNow when the Run now button is tapped.', () => {
        const onRunNow = jest.fn();
        render(
            <ZoneDetail
                zone={buildZone()}
                nextRun={undefined}
                activity={[]}
                isActivityLoading={false}
                onRunNow={onRunNow}
                onStopWatering={jest.fn()}
            />,
        );

        fireEvent.press(screen.getByText('Run now'));

        expect(onRunNow).toHaveBeenCalledTimes(1);
    });

    it('renders the View all in Activity link when onViewActivity is supplied (APP-67).', () => {
        const onViewActivity = jest.fn();
        render(
            <ZoneDetail
                zone={buildZone()}
                nextRun={undefined}
                activity={[]}
                isActivityLoading={false}
                onRunNow={jest.fn()}
                onStopWatering={jest.fn()}
                onViewActivity={onViewActivity}
            />,
        );

        fireEvent.press(screen.getByText('View all in Activity →'));

        expect(onViewActivity).toHaveBeenCalledTimes(1);
    });

    it('hides the View all in Activity link when onViewActivity is omitted (APP-67).', () => {
        render(
            <ZoneDetail
                zone={buildZone()}
                nextRun={undefined}
                activity={[]}
                isActivityLoading={false}
                onRunNow={jest.fn()}
                onStopWatering={jest.fn()}
            />,
        );

        expect(screen.queryByText('View all in Activity →')).toBeNull();
    });

    it('renders Run now and not Stop watering when the zone is not running (APP-69).', () => {
        render(
            <ZoneDetail
                zone={buildZone({ isRunning: false })}
                nextRun={undefined}
                activity={[]}
                isActivityLoading={false}
                onRunNow={jest.fn()}
                onStopWatering={jest.fn()}
            />,
        );

        expect(screen.getByText('Run now')).toBeOnTheScreen();
        expect(screen.queryByText('Stop watering')).toBeNull();
    });

    it('renders Stop watering and not Run now when the zone is running (APP-69).', () => {
        render(
            <ZoneDetail
                zone={buildZone({ isRunning: true })}
                nextRun={undefined}
                activity={[]}
                isActivityLoading={false}
                onRunNow={jest.fn()}
                onStopWatering={jest.fn()}
            />,
        );

        expect(screen.getByText('Stop watering')).toBeOnTheScreen();
        expect(screen.queryByText('Run now')).toBeNull();
    });

    it('fires onStopWatering — and not onRunNow — when Stop watering is tapped (APP-69).', () => {
        const onRunNow = jest.fn();
        const onStopWatering = jest.fn();
        render(
            <ZoneDetail
                zone={buildZone({ isRunning: true })}
                nextRun={undefined}
                activity={[]}
                isActivityLoading={false}
                onRunNow={onRunNow}
                onStopWatering={onStopWatering}
            />,
        );

        fireEvent.press(screen.getByText('Stop watering'));

        expect(onStopWatering).toHaveBeenCalledTimes(1);
        expect(onRunNow).not.toHaveBeenCalled();
    });

    it('disables Stop watering while the close mutation is in flight (APP-69).', () => {
        const onStopWatering = jest.fn();
        render(
            <ZoneDetail
                zone={buildZone({ isRunning: true })}
                nextRun={undefined}
                activity={[]}
                isActivityLoading={false}
                onRunNow={jest.fn()}
                onStopWatering={onStopWatering}
                isStopping
            />,
        );

        fireEvent.press(screen.getByText('Stop watering'));

        expect(onStopWatering).not.toHaveBeenCalled();
    });
});
