import { act, fireEvent, render, screen } from '@testing-library/react-native';

import type { ZoneSummary } from '@/api/types/zones';
import { FireSheet } from '.';

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
        ...overrides,
    };
}

function pressTimes(label: string, times: number) {
    for (let i = 0; i < times; i++) {
        fireEvent.press(screen.getByLabelText(label));
    }
}

describe('FireSheet', () => {
    it('renders the zone name and grass · area subtitle in the header.', () => {
        render(
            <FireSheet
                visible
                zone={buildZone()}
                onCancel={jest.fn()}
                onRun={jest.fn()}
            />,
        );

        expect(screen.getByText('Run North')).toBeOnTheScreen();
        expect(screen.getByText('Kentucky Bluegrass · 100 m²')).toBeOnTheScreen();
    });

    it('starts the duration stepper at 5 minutes.', () => {
        render(
            <FireSheet
                visible
                zone={buildZone()}
                onCancel={jest.fn()}
                onRun={jest.fn()}
            />,
        );

        expect(screen.getByText('5')).toBeOnTheScreen();
        expect(screen.getByText('minutes')).toBeOnTheScreen();
    });

    it('decrements the readout by 1 when the minus button is pressed.', () => {
        render(
            <FireSheet
                visible
                zone={buildZone()}
                onCancel={jest.fn()}
                onRun={jest.fn()}
            />,
        );

        fireEvent.press(screen.getByLabelText('Decrease minutes'));

        expect(screen.getByText('4')).toBeOnTheScreen();
    });

    it('increments the readout by 1 when the plus button is pressed.', () => {
        render(
            <FireSheet
                visible
                zone={buildZone()}
                onCancel={jest.fn()}
                onRun={jest.fn()}
            />,
        );

        fireEvent.press(screen.getByLabelText('Increase minutes'));

        expect(screen.getByText('6')).toBeOnTheScreen();
    });

    it('uses the singular "minute" label at 1 and "minutes" everywhere else.', () => {
        render(
            <FireSheet
                visible
                zone={buildZone()}
                onCancel={jest.fn()}
                onRun={jest.fn()}
            />,
        );

        // Plural at the default (5).
        expect(screen.getByText('minutes')).toBeOnTheScreen();

        // Step down to 1 — minus is pressed 4 times.
        pressTimes('Decrease minutes', 4);

        expect(screen.getByText('1')).toBeOnTheScreen();
        expect(screen.getByText('minute')).toBeOnTheScreen();
        expect(screen.queryByText('minutes')).toBeNull();
    });

    it('clamps at the minimum of 1 minute and disables the minus button.', () => {
        render(
            <FireSheet
                visible
                zone={buildZone()}
                onCancel={jest.fn()}
                onRun={jest.fn()}
            />,
        );

        // Step down past the floor; extra presses must be no-ops.
        pressTimes('Decrease minutes', 10);

        expect(screen.getByText('1')).toBeOnTheScreen();
        expect(screen.getByLabelText('Decrease minutes').props.accessibilityState).toMatchObject({ disabled: true });
    });

    it('clamps at the maximum of 60 minutes and disables the plus button.', () => {
        render(
            <FireSheet
                visible
                zone={buildZone()}
                onCancel={jest.fn()}
                onRun={jest.fn()}
            />,
        );

        // Step up past the ceiling; extra presses must be no-ops.
        pressTimes('Increase minutes', 80);

        expect(screen.getByText('60')).toBeOnTheScreen();
        expect(screen.getByLabelText('Increase minutes').props.accessibilityState).toMatchObject({ disabled: true });
    });

    it('fires onCancel — and not onRun — when Cancel is tapped.', () => {
        const onCancel = jest.fn();
        const onRun = jest.fn();
        render(
            <FireSheet
                visible
                zone={buildZone()}
                onCancel={onCancel}
                onRun={onRun}
            />,
        );

        fireEvent.press(screen.getByText('Cancel'));

        expect(onCancel).toHaveBeenCalledTimes(1);
        expect(onRun).not.toHaveBeenCalled();
    });

    it('fires onRun with the currently displayed minute count when Run now is tapped.', () => {
        const onRun = jest.fn();
        render(
            <FireSheet
                visible
                zone={buildZone()}
                onCancel={jest.fn()}
                onRun={onRun}
            />,
        );

        // Bump to 12.
        pressTimes('Increase minutes', 7);
        fireEvent.press(screen.getByText('Run now'));

        expect(onRun).toHaveBeenCalledTimes(1);
        expect(onRun).toHaveBeenCalledWith(12);
    });

    it('disables Run now while the caller marks the mutation as submitting.', () => {
        const onRun = jest.fn();
        render(
            <FireSheet
                visible
                zone={buildZone()}
                onCancel={jest.fn()}
                onRun={onRun}
                isSubmitting
            />,
        );

        fireEvent.press(screen.getByText('Run now'));

        expect(onRun).not.toHaveBeenCalled();
    });

    it('resets the readout to 5 each time the sheet is re-opened.', () => {
        const { rerender } = render(
            <FireSheet
                visible
                zone={buildZone()}
                onCancel={jest.fn()}
                onRun={jest.fn()}
            />,
        );

        // User picks 20 in the first opening.
        pressTimes('Increase minutes', 15);
        expect(screen.getByText('20')).toBeOnTheScreen();

        // Close and re-open.
        act(() => {
            rerender(
                <FireSheet
                    visible={false}
                    zone={buildZone()}
                    onCancel={jest.fn()}
                    onRun={jest.fn()}
                />,
            );
        });
        act(() => {
            rerender(
                <FireSheet
                    visible
                    zone={buildZone()}
                    onCancel={jest.fn()}
                    onRun={jest.fn()}
                />,
            );
        });

        expect(screen.getByText('5')).toBeOnTheScreen();
    });
});
