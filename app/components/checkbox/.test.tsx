import { fireEvent, render, screen } from '@testing-library/react-native';

import { Checkbox } from '.';

describe('Checkbox', () => {
    it('renders the label text passed as children.', () => {
        render(
            <Checkbox value={false} onValueChange={() => {}}>
                Re-plan now from current depletion
            </Checkbox>,
        );

        expect(screen.getByText('Re-plan now from current depletion')).toBeOnTheScreen();
    });

    it('fires onValueChange with the negated value when pressed.', () => {
        const onValueChange = jest.fn();

        render(
            <Checkbox value={false} onValueChange={onValueChange}>
                Notify when first cycles are queued
            </Checkbox>,
        );
        fireEvent.press(screen.getByRole('checkbox'));

        expect(onValueChange).toHaveBeenCalledWith(true);
    });

    it('negates again when the checkbox is currently checked.', () => {
        const onValueChange = jest.fn();

        render(
            <Checkbox value={true} onValueChange={onValueChange}>
                Re-plan
            </Checkbox>,
        );
        fireEvent.press(screen.getByRole('checkbox'));

        expect(onValueChange).toHaveBeenCalledWith(false);
    });

    it('does not fire onValueChange when disabled.', () => {
        const onValueChange = jest.fn();

        render(
            <Checkbox value={false} onValueChange={onValueChange} disabled>
                Re-plan
            </Checkbox>,
        );
        fireEvent.press(screen.getByRole('checkbox'));

        expect(onValueChange).not.toHaveBeenCalled();
    });

    it('exposes the checked state to assistive tech.', () => {
        render(
            <Checkbox value={true} onValueChange={() => {}}>
                Re-plan
            </Checkbox>,
        );

        expect(screen.getByRole('checkbox').props.accessibilityState).toMatchObject({ checked: true });
    });

    it('uses the label text as the accessibility label by default.', () => {
        render(
            <Checkbox value={false} onValueChange={() => {}}>
                Re-plan now from current depletion
            </Checkbox>,
        );

        expect(screen.getByLabelText('Re-plan now from current depletion')).toBeOnTheScreen();
    });

    it('honors an explicit accessibility label override.', () => {
        render(
            <Checkbox value={false} onValueChange={() => {}} accessibilityLabel='replan-toggle'>
                Re-plan
            </Checkbox>,
        );

        expect(screen.getByLabelText('replan-toggle')).toBeOnTheScreen();
    });

    it('renders the checkmark only when value is true.', () => {
        const { rerender } = render(
            <Checkbox value={false} onValueChange={() => {}}>
                Re-plan
            </Checkbox>,
        );

        expect(screen.queryByLabelText('check')).toBeNull();

        rerender(
            <Checkbox value={true} onValueChange={() => {}}>
                Re-plan
            </Checkbox>,
        );

        expect(screen.getByLabelText('check')).toBeOnTheScreen();
    });
});
