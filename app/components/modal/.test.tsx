import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet, Text } from 'react-native';
import { BlurView } from 'expo-blur';

import { Modal } from '.';

describe('Modal', () => {
    it('renders its children when visible.', () => {
        render(
            <Modal visible onRequestClose={() => {}}>
                <Text>Dialog body</Text>
            </Modal>,
        );

        expect(screen.getByText('Dialog body')).toBeOnTheScreen();
    });

    it('hides its children when not visible.', () => {
        render(
            <Modal visible={false} onRequestClose={() => {}}>
                <Text>Dialog body</Text>
            </Modal>,
        );

        expect(screen.queryByText('Dialog body')).toBeNull();
    });

    it('calls `onRequestClose` when the user taps the backdrop.', () => {
        const onRequestClose = jest.fn();
        const { root } = render(
            <Modal visible onRequestClose={onRequestClose}>
                <Text>Dialog body</Text>
            </Modal>,
        );

        // The container sets `accessibilityViewIsModal`, which hides sibling
        // a11y nodes (including the backdrop Pressable) from a11y queries —
        // exactly what screen readers expect. Reach the press target via
        // host-tree lookup instead so we can still exercise the tap.
        const backdrop = root.find(
            node =>
                typeof node.type === 'string' &&
                node.props.accessibilityLabel === 'Dismiss modal',
        );
        fireEvent.press(backdrop);

        expect(onRequestClose).toHaveBeenCalledTimes(1);
    });

    it('paints the scrim layer with the design rgba(2, 4, 3, 0.66) colour.', () => {
        const { root } = render(
            <Modal visible onRequestClose={() => {}}>
                <Text>Dialog body</Text>
            </Modal>,
        );

        // Walk host nodes only (string `type`) to avoid double-counting the
        // React component wrapper that shares props with its underlying host.
        const scrim = root.findAll(node => {
            if (typeof node.type !== 'string') return false;
            const style = StyleSheet.flatten(node.props.style as Parameters<typeof StyleSheet.flatten>[0]) as
                | { backgroundColor?: string }
                | undefined;
            return style?.backgroundColor === 'rgba(2, 4, 3, 0.66)';
        });

        expect(scrim).toHaveLength(1);
    });

    it('renders a BlurView in the backdrop for the 8px-equivalent backdrop blur.', () => {
        const { root } = render(
            <Modal visible onRequestClose={() => {}}>
                <Text>Dialog body</Text>
            </Modal>,
        );

        const blurs = root.findAllByType(BlurView);

        expect(blurs).toHaveLength(1);
        expect(blurs[0].props.intensity).toBe(50);
        expect(blurs[0].props.tint).toBe('dark');
    });

    it('exposes the caller-provided accessibility label on the container.', () => {
        render(
            <Modal visible onRequestClose={() => {}} accessibilityLabel='Switch schedule'>
                <Text>Dialog body</Text>
            </Modal>,
        );

        expect(screen.getByLabelText('Switch schedule')).toBeOnTheScreen();
    });
});
