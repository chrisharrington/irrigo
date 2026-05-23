import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { Field, Input } from '.';

describe('Input', () => {
    it('renders the placeholder.', () => {
        render(<Input value='' onChangeText={() => {}} placeholder='Search zones' />);

        expect(screen.getByPlaceholderText('Search zones')).toBeOnTheScreen();
    });

    it('fires onChangeText with the new value when the user types.', () => {
        const onChangeText = jest.fn();

        render(<Input value='' onChangeText={onChangeText} placeholder='Search' />);
        fireEvent.changeText(screen.getByPlaceholderText('Search'), 'No');

        expect(onChangeText).toHaveBeenCalledWith('No');
    });

    it('reflects the controlled value.', () => {
        render(<Input value='North' onChangeText={() => {}} placeholder='Search' />);

        expect(screen.getByDisplayValue('North')).toBeOnTheScreen();
    });

    it('does not fire onChangeText when disabled.', () => {
        const onChangeText = jest.fn();

        render(<Input value='' onChangeText={onChangeText} placeholder='Search' disabled />);
        fireEvent.changeText(screen.getByPlaceholderText('Search'), 'x');

        expect(onChangeText).not.toHaveBeenCalled();
    });

    it('marks the input as not editable when disabled.', () => {
        render(<Input value='' onChangeText={() => {}} placeholder='Search' disabled />);

        expect(screen.getByPlaceholderText('Search').props.editable).toBe(false);
    });

    it('uses the placeholder as the accessibility label by default.', () => {
        render(<Input value='' onChangeText={() => {}} placeholder='Search zones' />);

        expect(screen.getByLabelText('Search zones')).toBeOnTheScreen();
    });

    it('honors an explicit accessibility label override.', () => {
        render(
            <Input
                value=''
                onChangeText={() => {}}
                placeholder='Search'
                accessibilityLabel='zone-search'
            />,
        );

        expect(screen.getByLabelText('zone-search')).toBeOnTheScreen();
    });

    it('paints the focused state when the user focuses the field and clears it on blur.', () => {
        render(<Input value='' onChangeText={() => {}} placeholder='Search' />);

        const field = screen.getByPlaceholderText('Search');
        act(() => {
            fireEvent(field, 'focus');
        });
        expect(field.props.className).toContain('border-accent');

        act(() => {
            fireEvent(field, 'blur');
        });
        expect(field.props.className).not.toContain('border-accent');
    });

    it('paints the invalid border when `invalid` is true.', () => {
        render(<Input value='' onChangeText={() => {}} placeholder='Search' invalid />);

        expect(screen.getByPlaceholderText('Search').props.className).toContain('border-danger');
    });
});

describe('Field', () => {
    it('renders the label, the control, and the hint.', () => {
        render(
            <Field label='Duration' hint='Minutes per cycle'>
                <Input value='' onChangeText={() => {}} placeholder='Duration in minutes' />
            </Field>,
        );

        expect(screen.getByText('Duration')).toBeOnTheScreen();
        expect(screen.getByPlaceholderText('Duration in minutes')).toBeOnTheScreen();
        expect(screen.getByText('Minutes per cycle')).toBeOnTheScreen();
    });

    it('suppresses the hint and shows the error text in danger color when `err` is set.', () => {
        render(
            <Field label='Duration' hint='Minutes per cycle' err='Must be a positive number.'>
                <Input value='' onChangeText={() => {}} placeholder='Duration' />
            </Field>,
        );

        expect(screen.queryByText('Minutes per cycle')).toBeNull();
        expect(screen.getByText('Must be a positive number.')).toBeOnTheScreen();
    });

    it('omits the label slot when no label is provided.', () => {
        render(
            <Field hint='Minutes'>
                <Input value='' onChangeText={() => {}} placeholder='Duration' />
            </Field>,
        );

        expect(screen.getByText('Minutes')).toBeOnTheScreen();
        expect(screen.queryByText('Duration')).toBeNull(); // placeholder text only on the input itself; no label above
    });
});
