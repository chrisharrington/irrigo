import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { StyleSheet, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { ActiveScheduleChip } from '.';
import { TILE_GRADIENT_COLORS } from '@/components/tile-gradient';
import type { ScheduleListItem } from '@/api/types/schedules';
import config from '@/tailwind.config';

const colors = config.theme.extend.colors;

const ACTIVE_SCHEDULE: ScheduleListItem = {
    id: 'sched-active',
    slug: 'maintenance',
    name: 'Maintenance',
    isActive: true,
    allowedDays: [3, 5, 7], // Wed, Fri, Sun.
    allowedTimeWindows: [{ start: '22:00', end: '06:00' }],
    rootDepthMOverride: 0.18,
    allowableDepletionFractionOverride: 0.5,
    endBySunrise: true,
    nextRun: { inLabel: '8h 14m', whenLabel: 'tonight at 10:23pm', zonesLabel: 'North + East' },
    skippedTonight: false,
};

const NO_NEXT_RUN_SCHEDULE: ScheduleListItem = {
    ...ACTIVE_SCHEDULE,
    nextRun: null,
};

describe('ActiveScheduleChip', () => {
    it('renders the eyebrow, schedule name, and countdown.', () => {
        render(<ActiveScheduleChip schedule={ACTIVE_SCHEDULE} onPress={() => {}} />);

        expect(screen.getByText('On profile')).toBeOnTheScreen();
        expect(screen.getByText('Maintenance')).toBeOnTheScreen();
        expect(screen.getByText('8h 14m')).toBeOnTheScreen();
    });

    it('hides the RUNNING badge by default (active schedule not firing).', () => {
        render(<ActiveScheduleChip schedule={ACTIVE_SCHEDULE} onPress={() => {}} />);

        expect(screen.queryByText('RUNNING')).toBeNull();
    });

    it('hides the RUNNING badge when isRunning is false.', () => {
        render(<ActiveScheduleChip schedule={ACTIVE_SCHEDULE} onPress={() => {}} isRunning={false} />);

        expect(screen.queryByText('RUNNING')).toBeNull();
    });

    it('renders the RUNNING badge when isRunning is true.', () => {
        render(<ActiveScheduleChip schedule={ACTIVE_SCHEDULE} onPress={() => {}} isRunning />);

        expect(screen.getByText('RUNNING')).toBeOnTheScreen();
    });

    it('renders an em-dash countdown when nextRun is null.', () => {
        render(<ActiveScheduleChip schedule={NO_NEXT_RUN_SCHEDULE} onPress={() => {}} />);

        expect(screen.getByText('—')).toBeOnTheScreen();
    });

    it('exposes the mini day strip via accessibility label.', () => {
        render(<ActiveScheduleChip schedule={ACTIVE_SCHEDULE} onPress={() => {}} />);

        expect(screen.getByLabelText('Schedule days')).toBeOnTheScreen();
    });

    it('fires `onPress` when the chip is tapped.', () => {
        const onPress = jest.fn();
        render(<ActiveScheduleChip schedule={ACTIVE_SCHEDULE} onPress={onPress} />);

        fireEvent.press(screen.getByLabelText('Open Schedules — active profile Maintenance'));

        expect(onPress).toHaveBeenCalledTimes(1);
    });

    it('paints the elevated gradient and accent-border on the inner TileGradient (APP-47 / APP-60).', () => {
        render(<ActiveScheduleChip schedule={ACTIVE_SCHEDULE} onPress={() => {}} />);

        const card = screen.getByLabelText('Open Schedules — active profile Maintenance');
        const gradient = within(card).UNSAFE_getByType(LinearGradient);
        const style = StyleSheet.flatten(gradient.props.style) as ViewStyle;

        expect(gradient.props.colors).toEqual([...TILE_GRADIENT_COLORS.elevated]);
        expect(style.borderColor).toBe(colors['accent-border']);
    });
});
