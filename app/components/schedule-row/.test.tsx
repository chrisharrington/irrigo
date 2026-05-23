import { fireEvent, render, screen } from '@testing-library/react-native';

import { ScheduleRow } from '.';
import type { ScheduleListItem } from '@/api/types/schedules';

const SAMPLE_SCHEDULE: ScheduleListItem = {
    id: 'sched-002',
    slug: 'weekend',
    name: 'Weekend',
    isActive: false,
    allowedDays: [6, 7],
    allowedTimeWindows: [{ start: '20:00', end: '04:00' }],
    rootDepthMOverride: null,
    allowableDepletionFractionOverride: null,
    endBySunrise: null,
};

describe('ScheduleRow', () => {
    it('renders the schedule name and the days · window summary.', () => {
        render(<ScheduleRow schedule={SAMPLE_SCHEDULE} onSwitch={() => {}} />);

        expect(screen.getByText('Weekend')).toBeOnTheScreen();
        expect(screen.getByText('Sat · Sun · 20:00 → 04:00')).toBeOnTheScreen();
    });

    it('renders the Switch label and is queryable by its accessibility label.', () => {
        render(<ScheduleRow schedule={SAMPLE_SCHEDULE} onSwitch={() => {}} />);

        expect(screen.getByText('Switch')).toBeOnTheScreen();
        expect(screen.getByLabelText('Switch to Weekend')).toBeOnTheScreen();
    });

    it('fires `onSwitch` with the schedule when pressed.', () => {
        const onSwitch = jest.fn();
        render(<ScheduleRow schedule={SAMPLE_SCHEDULE} onSwitch={onSwitch} />);

        fireEvent.press(screen.getByLabelText('Switch to Weekend'));

        expect(onSwitch).toHaveBeenCalledTimes(1);
        expect(onSwitch).toHaveBeenCalledWith(SAMPLE_SCHEDULE);
    });
});
