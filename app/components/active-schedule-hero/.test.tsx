import { fireEvent, render, screen } from '@testing-library/react-native';

import { ActiveScheduleHero } from '.';
import type { ScheduleListItem } from '@/api/types/schedules';

const BASE_SCHEDULE: ScheduleListItem = {
    id: 'sched-001',
    slug: 'maintenance',
    name: 'Maintenance',
    isActive: true,
    allowedDays: [1, 3, 5],
    allowedTimeWindows: [{ start: '22:00', end: '06:00' }],
    rootDepthMOverride: 0.18,
    allowableDepletionFractionOverride: 0.5,
    endBySunrise: true,
    nextRun: { inLabel: '4h 32m', whenLabel: 'tonight at 10:23pm', zonesLabel: 'North + East' },
    skippedTonight: false,
};

const NULL_RULES_SCHEDULE: ScheduleListItem = {
    ...BASE_SCHEDULE,
    rootDepthMOverride: null,
    allowableDepletionFractionOverride: null,
    endBySunrise: false,
    nextRun: null,
    allowedDays: null,
    allowedTimeWindows: null,
};

const noop = () => {};

describe('ActiveScheduleHero', () => {
    it('renders the schedule name and the days · window summary.', () => {
        render(
            <ActiveScheduleHero
                schedule={BASE_SCHEDULE}
                skipping={false}
                onReplan={noop}
                onSwitchProfile={noop}
                onToggleSkip={noop}
            />,
        );

        expect(screen.getByText('Maintenance')).toBeOnTheScreen();
        expect(screen.getByText('Mon · Wed · Fri · 22:00 → 06:00')).toBeOnTheScreen();
    });

    it('renders the next-run labels when not skipping.', () => {
        render(
            <ActiveScheduleHero
                schedule={BASE_SCHEDULE}
                skipping={false}
                onReplan={noop}
                onSwitchProfile={noop}
                onToggleSkip={noop}
            />,
        );

        expect(screen.getByText('4h 32m')).toBeOnTheScreen();
        expect(screen.getByText('tonight at 10:23pm · North + East')).toBeOnTheScreen();
    });

    it('replaces the next-run section with the skip message when skipping.', () => {
        render(
            <ActiveScheduleHero
                schedule={BASE_SCHEDULE}
                skipping
                onReplan={noop}
                onSwitchProfile={noop}
                onToggleSkip={noop}
            />,
        );

        expect(screen.getByText('Skipped tonight. Re-evaluating tomorrow morning.')).toBeOnTheScreen();
        expect(screen.queryByText('4h 32m')).toBeNull();
    });

    it('shows the skip-tonight banner only when skipping.', () => {
        const { rerender } = render(
            <ActiveScheduleHero
                schedule={BASE_SCHEDULE}
                skipping={false}
                onReplan={noop}
                onSwitchProfile={noop}
                onToggleSkip={noop}
            />,
        );

        expect(screen.queryByLabelText('Tonight skipped')).toBeNull();

        rerender(
            <ActiveScheduleHero
                schedule={BASE_SCHEDULE}
                skipping
                onReplan={noop}
                onSwitchProfile={noop}
                onToggleSkip={noop}
            />,
        );

        expect(screen.getByLabelText('Tonight skipped')).toBeOnTheScreen();
    });

    it('renders all four rule rows with the schedule values.', () => {
        render(
            <ActiveScheduleHero
                schedule={BASE_SCHEDULE}
                skipping={false}
                onReplan={noop}
                onSwitchProfile={noop}
                onToggleSkip={noop}
            />,
        );

        expect(screen.getByLabelText('Time window: 22:00 → 06:00')).toBeOnTheScreen();
        expect(screen.getByLabelText('End by sunrise: On')).toBeOnTheScreen();
        expect(screen.getByLabelText('Root depth override: 0.18 m')).toBeOnTheScreen();
        expect(screen.getByLabelText('Depletion fraction: 0.50')).toBeOnTheScreen();
    });

    it('renders em-dashes and `Off`/`Any time` for the null-rule fallbacks.', () => {
        render(
            <ActiveScheduleHero
                schedule={NULL_RULES_SCHEDULE}
                skipping={false}
                onReplan={noop}
                onSwitchProfile={noop}
                onToggleSkip={noop}
            />,
        );

        expect(screen.getByLabelText('Time window: Any time')).toBeOnTheScreen();
        expect(screen.getByLabelText('End by sunrise: Off')).toBeOnTheScreen();
        expect(screen.getByLabelText('Root depth override: —')).toBeOnTheScreen();
        expect(screen.getByLabelText('Depletion fraction: —')).toBeOnTheScreen();
    });

    it('flips the footer button label between Skip tonight and Resume tonight.', () => {
        const { rerender } = render(
            <ActiveScheduleHero
                schedule={BASE_SCHEDULE}
                skipping={false}
                onReplan={noop}
                onSwitchProfile={noop}
                onToggleSkip={noop}
            />,
        );

        expect(screen.getByText('Skip tonight')).toBeOnTheScreen();
        expect(screen.queryByText('Resume tonight')).toBeNull();

        rerender(
            <ActiveScheduleHero
                schedule={BASE_SCHEDULE}
                skipping
                onReplan={noop}
                onSwitchProfile={noop}
                onToggleSkip={noop}
            />,
        );

        expect(screen.getByText('Resume tonight')).toBeOnTheScreen();
        expect(screen.queryByText('Skip tonight')).toBeNull();
    });

    it('fires `onReplan` when the re-plan icon button is pressed.', () => {
        const onReplan = jest.fn();
        render(
            <ActiveScheduleHero
                schedule={BASE_SCHEDULE}
                skipping={false}
                onReplan={onReplan}
                onSwitchProfile={noop}
                onToggleSkip={noop}
            />,
        );

        fireEvent.press(screen.getByLabelText('Re-plan now'));

        expect(onReplan).toHaveBeenCalledTimes(1);
    });

    it('fires `onSwitchProfile` when the Switch profile button is pressed.', () => {
        const onSwitchProfile = jest.fn();
        render(
            <ActiveScheduleHero
                schedule={BASE_SCHEDULE}
                skipping={false}
                onReplan={noop}
                onSwitchProfile={onSwitchProfile}
                onToggleSkip={noop}
            />,
        );

        fireEvent.press(screen.getByText('Switch profile'));

        expect(onSwitchProfile).toHaveBeenCalledTimes(1);
    });

    it('fires `onToggleSkip` when the Skip tonight button is pressed.', () => {
        const onToggleSkip = jest.fn();
        render(
            <ActiveScheduleHero
                schedule={BASE_SCHEDULE}
                skipping={false}
                onReplan={noop}
                onSwitchProfile={noop}
                onToggleSkip={onToggleSkip}
            />,
        );

        fireEvent.press(screen.getByText('Skip tonight'));

        expect(onToggleSkip).toHaveBeenCalledTimes(1);
    });

    it('disables the re-plan button while `isReplanning` is true.', () => {
        const onReplan = jest.fn();
        render(
            <ActiveScheduleHero
                schedule={BASE_SCHEDULE}
                skipping={false}
                isReplanning
                onReplan={onReplan}
                onSwitchProfile={noop}
                onToggleSkip={noop}
            />,
        );

        fireEvent.press(screen.getByLabelText('Re-plan now'));

        expect(onReplan).not.toHaveBeenCalled();
    });
});
