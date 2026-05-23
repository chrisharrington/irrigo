import { fireEvent, render, screen } from '@testing-library/react-native';

import { SwitchScheduleModal } from '.';
import type { ScheduleListItem } from '@/api/types/schedules';

const SAMPLE_SCHEDULE: ScheduleListItem = {
    id: 'sched-002',
    slug: 'weekend',
    name: 'Weekend',
    isActive: false,
    allowedDays: [6, 7],
    allowedTimeWindows: null,
    rootDepthMOverride: null,
    allowableDepletionFractionOverride: null,
    endBySunrise: null,
};

describe('SwitchScheduleModal', () => {
    it('renders nothing when schedule is null.', () => {
        render(
            <SwitchScheduleModal
                schedule={null}
                onCancel={() => {}}
                onConfirm={() => {}}
            />,
        );

        expect(screen.queryByText(/Switch to/)).toBeNull();
    });

    it('renders the title and body when a schedule is supplied.', () => {
        render(
            <SwitchScheduleModal
                schedule={SAMPLE_SCHEDULE}
                onCancel={() => {}}
                onConfirm={() => {}}
            />,
        );

        expect(screen.getByText('Switch to Weekend?')).toBeOnTheScreen();
        expect(
            screen.getByText('Active schedule will be replaced. A re-plan will run immediately.'),
        ).toBeOnTheScreen();
    });

    it('fires `onCancel` when the Cancel button is pressed.', () => {
        const onCancel = jest.fn();
        render(
            <SwitchScheduleModal
                schedule={SAMPLE_SCHEDULE}
                onCancel={onCancel}
                onConfirm={() => {}}
            />,
        );

        fireEvent.press(screen.getByText('Cancel'));

        expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('fires `onConfirm` when the Switch & re-plan button is pressed.', () => {
        const onConfirm = jest.fn();
        render(
            <SwitchScheduleModal
                schedule={SAMPLE_SCHEDULE}
                onCancel={() => {}}
                onConfirm={onConfirm}
            />,
        );

        fireEvent.press(screen.getByText('Switch & re-plan'));

        expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    it('disables the confirm button while submitting.', () => {
        const onConfirm = jest.fn();
        render(
            <SwitchScheduleModal
                schedule={SAMPLE_SCHEDULE}
                onCancel={() => {}}
                onConfirm={onConfirm}
                isSubmitting
            />,
        );

        fireEvent.press(screen.getByText('Switch & re-plan'));

        expect(onConfirm).not.toHaveBeenCalled();
    });
});
