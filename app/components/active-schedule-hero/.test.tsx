import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { ActiveScheduleHero } from '.';
import type { ScheduleListItem } from '@/api/types/schedules';

jest.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 0, bottom: 34, left: 0, right: 0 }),
}));

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
    it('renders the schedule name and lights up the allowed days in the day strip.', () => {
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
        // allowedDays [1, 3, 5] → Mon / Wed / Fri are active; other days stay inactive.
        expect(screen.getByLabelText('Monday: active')).toBeOnTheScreen();
        expect(screen.getByLabelText('Wednesday: active')).toBeOnTheScreen();
        expect(screen.getByLabelText('Friday: active')).toBeOnTheScreen();
        expect(screen.getByLabelText('Tuesday: inactive')).toBeOnTheScreen();
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

    it('renders the three rule rows with the schedule values.', () => {
        render(
            <ActiveScheduleHero
                schedule={BASE_SCHEDULE}
                skipping={false}
                onReplan={noop}
                onSwitchProfile={noop}
                onToggleSkip={noop}
            />,
        );

        expect(screen.getByLabelText('End by sunrise: On')).toBeOnTheScreen();
        expect(screen.getByLabelText('Root depth override: 0.18 m')).toBeOnTheScreen();
        expect(screen.getByLabelText('Depletion fraction: 0.50')).toBeOnTheScreen();
    });

    it('renders em-dashes and `Off` for the null-rule fallbacks.', () => {
        render(
            <ActiveScheduleHero
                schedule={NULL_RULES_SCHEDULE}
                skipping={false}
                onReplan={noop}
                onSwitchProfile={noop}
                onToggleSkip={noop}
            />,
        );

        expect(screen.getByLabelText('End by sunrise: Off')).toBeOnTheScreen();
        expect(screen.getByLabelText('Root depth override: —')).toBeOnTheScreen();
        expect(screen.getByLabelText('Depletion fraction: —')).toBeOnTheScreen();
    });

    it('exposes a help trigger on the Root depth and Depletion rows, closed by default.', () => {
        render(
            <ActiveScheduleHero
                schedule={BASE_SCHEDULE}
                skipping={false}
                onReplan={noop}
                onSwitchProfile={noop}
                onToggleSkip={noop}
            />,
        );

        expect(screen.getByLabelText('What is Root depth override?')).toBeOnTheScreen();
        expect(screen.getByLabelText('What is Depletion fraction?')).toBeOnTheScreen();
        // Sheets stay closed until a trigger is tapped.
        expect(screen.queryByText(/Management Allowable Depletion/)).toBeNull();
    });

    it('opens the Root depth help sheet with its title and body when the trigger is tapped.', () => {
        render(
            <ActiveScheduleHero
                schedule={BASE_SCHEDULE}
                skipping={false}
                onReplan={noop}
                onSwitchProfile={noop}
                onToggleSkip={noop}
            />,
        );

        fireEvent.press(screen.getByLabelText('What is Root depth override?'));

        // The sheet heading and the row label share the text; both instances render.
        expect(screen.getAllByText('Root depth override').length).toBeGreaterThan(1);
        expect(screen.getByText(/the planner aims to refill/)).toBeOnTheScreen();
    });

    it('opens the Depletion fraction help sheet, and the backdrop dismisses it.', async () => {
        const { root } = render(
            <ActiveScheduleHero
                schedule={BASE_SCHEDULE}
                skipping={false}
                onReplan={noop}
                onSwitchProfile={noop}
                onToggleSkip={noop}
            />,
        );

        fireEvent.press(screen.getByLabelText('What is Depletion fraction?'));
        expect(screen.getByText(/Management Allowable Depletion/)).toBeOnTheScreen();

        const backdrop = root.find(
            node =>
                typeof node.type === 'string' &&
                node.props.accessibilityLabel === 'Dismiss modal',
        );
        fireEvent.press(backdrop);

        // The sheet animates closed before unmounting.
        await waitFor(
            () => expect(screen.queryByText(/Management Allowable Depletion/)).toBeNull(),
            { timeout: 5000 },
        );
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
