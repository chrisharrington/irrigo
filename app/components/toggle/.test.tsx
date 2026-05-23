import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet, View } from 'react-native';

import { Toggle } from '.';

describe('Toggle', () => {
    it('exposes the switch role with the supplied accessibility label.', () => {
        render(<Toggle value={false} onValueChange={() => {}} accessibilityLabel='Master irrigation' />);

        expect(screen.getByRole('switch', { name: 'Master irrigation' })).toBeOnTheScreen();
    });

    it('fires onValueChange with the negated value when pressed.', () => {
        const onValueChange = jest.fn();

        render(<Toggle value={false} onValueChange={onValueChange} accessibilityLabel='Toggle' />);
        fireEvent.press(screen.getByRole('switch'));

        expect(onValueChange).toHaveBeenCalledWith(true);
    });

    it('negates again when the toggle is currently on.', () => {
        const onValueChange = jest.fn();

        render(<Toggle value={true} onValueChange={onValueChange} accessibilityLabel='Toggle' />);
        fireEvent.press(screen.getByRole('switch'));

        expect(onValueChange).toHaveBeenCalledWith(false);
    });

    it('does not fire onValueChange when disabled.', () => {
        const onValueChange = jest.fn();

        render(<Toggle value={false} onValueChange={onValueChange} disabled accessibilityLabel='Toggle' />);
        fireEvent.press(screen.getByRole('switch'));

        expect(onValueChange).not.toHaveBeenCalled();
    });

    it('exposes the checked state to assistive tech.', () => {
        render(<Toggle value={true} onValueChange={() => {}} accessibilityLabel='Toggle' />);

        expect(screen.getByRole('switch').props.accessibilityState).toMatchObject({ checked: true, disabled: false });
    });

    it('exposes the disabled state to assistive tech.', () => {
        render(<Toggle value={false} onValueChange={() => {}} disabled accessibilityLabel='Toggle' />);

        expect(screen.getByRole('switch').props.accessibilityState).toMatchObject({ disabled: true });
    });

    it.each([
        ['default', 44, 26],
        ['lg', 54, 30],
    ] as const)('renders the %s size at the documented %dx%d dimensions.', (size, width, height) => {
        const { root } = render(<Toggle value={false} onValueChange={() => {}} size={size} accessibilityLabel='Toggle' />);

        const sized = root.findAll(node => {
            if (node.type !== View) return false;
            const style = StyleSheet.flatten(node.props.style as Parameters<typeof StyleSheet.flatten>[0]) as
                | { width?: number; height?: number }
                | undefined;
            return style?.width === width && style?.height === height;
        });
        expect(sized.length).toBeGreaterThan(0);
    });
});
