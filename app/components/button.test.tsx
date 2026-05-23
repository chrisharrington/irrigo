import { fireEvent, render, screen } from '@testing-library/react-native';

import { Button } from './button';
import { More } from './icons';

describe('Button', () => {
    it('renders the text passed as children.', () => {
        render(<Button>Run now</Button>);

        expect(screen.getByText('Run now')).toBeOnTheScreen();
    });

    it('calls onPress when the user taps the button.', () => {
        const onPress = jest.fn();

        render(<Button onPress={onPress}>Run now</Button>);
        fireEvent.press(screen.getByText('Run now'));

        expect(onPress).toHaveBeenCalledTimes(1);
    });

    it('does not call onPress when the button is disabled.', () => {
        const onPress = jest.fn();

        render(
            <Button onPress={onPress} disabled>
                Run now
            </Button>,
        );
        fireEvent.press(screen.getByText('Run now'));

        expect(onPress).not.toHaveBeenCalled();
    });

    it('exposes the disabled state to assistive tech.', () => {
        render(<Button disabled>Run now</Button>);

        expect(screen.getByRole('button').props.accessibilityState).toMatchObject({ disabled: true });
    });

    it('reports an enabled state by default.', () => {
        render(<Button>Run now</Button>);

        expect(screen.getByRole('button').props.accessibilityState).toMatchObject({ disabled: false });
    });

    it('uses the supplied accessibility label on icon-only buttons.', () => {
        render(
            <Button iconOnly accessibilityLabel='More'>
                <More accessibilityLabel='More icon' />
            </Button>,
        );

        expect(screen.getByLabelText('More')).toBeOnTheScreen();
        expect(screen.getByLabelText('More icon')).toBeOnTheScreen();
    });

    it.each(['primary', 'secondary', 'ghost'] as const)('renders the %s variant without crashing.', variant => {
        render(<Button variant={variant}>Run now</Button>);

        expect(screen.getByText('Run now')).toBeOnTheScreen();
    });

    it.each(['sm', 'default', 'lg'] as const)('renders the %s size without crashing.', size => {
        render(<Button size={size}>Run now</Button>);

        expect(screen.getByText('Run now')).toBeOnTheScreen();
    });

    it('renders with default props (primary / default / no iconOnly).', () => {
        const onPress = jest.fn();

        render(<Button onPress={onPress}>Run now</Button>);
        fireEvent.press(screen.getByText('Run now'));

        expect(onPress).toHaveBeenCalledTimes(1);
    });

    it('passes icon-only children through without wrapping them in a Text node.', () => {
        render(
            <Button iconOnly accessibilityLabel='More options'>
                <More accessibilityLabel='More glyph' />
            </Button>,
        );

        // If the icon were wrapped in <Text>, React Native would crash trying
        // to render a non-string child; the icon being queryable proves the
        // bare-child pass-through.
        expect(screen.getByLabelText('More glyph')).toBeOnTheScreen();
    });
});
