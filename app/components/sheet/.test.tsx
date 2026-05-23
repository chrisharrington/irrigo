import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet, Text } from 'react-native';
import { BlurView } from 'expo-blur';

import { Sheet } from '.';

describe('Sheet', () => {
    it('renders its children when visible.', () => {
        render(
            <Sheet visible onRequestClose={() => {}}>
                <Text>Sheet body</Text>
            </Sheet>,
        );

        expect(screen.getByText('Sheet body')).toBeOnTheScreen();
    });

    it('hides its children when not visible.', () => {
        render(
            <Sheet visible={false} onRequestClose={() => {}}>
                <Text>Sheet body</Text>
            </Sheet>,
        );

        expect(screen.queryByText('Sheet body')).toBeNull();
    });

    it('calls `onRequestClose` when the user taps the backdrop.', () => {
        const onRequestClose = jest.fn();
        const { root } = render(
            <Sheet visible onRequestClose={onRequestClose}>
                <Text>Sheet body</Text>
            </Sheet>,
        );

        const backdrop = root.find(
            node =>
                typeof node.type === 'string' &&
                node.props.accessibilityLabel === 'Dismiss sheet',
        );
        fireEvent.press(backdrop);

        expect(onRequestClose).toHaveBeenCalledTimes(1);
    });

    it('paints the scrim layer with the design rgba(2, 4, 3, 0.66) colour.', () => {
        const { root } = render(
            <Sheet visible onRequestClose={() => {}}>
                <Text>Sheet body</Text>
            </Sheet>,
        );

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
            <Sheet visible onRequestClose={() => {}}>
                <Text>Sheet body</Text>
            </Sheet>,
        );

        const blurs = root.findAllByType(BlurView);

        expect(blurs).toHaveLength(1);
        expect(blurs[0].props.intensity).toBe(50);
        expect(blurs[0].props.tint).toBe('dark');
    });

    it('anchors the overlay to the bottom of the screen.', () => {
        const { root } = render(
            <Sheet visible onRequestClose={() => {}}>
                <Text>Sheet body</Text>
            </Sheet>,
        );

        // The overlay is the first host View under the Modal — it owns the
        // bottom-anchoring `justifyContent: 'flex-end'` layout.
        const overlay = root.find(
            node =>
                typeof node.type === 'string' &&
                node.type === 'View' &&
                (StyleSheet.flatten(node.props.style as Parameters<typeof StyleSheet.flatten>[0]) as
                    | { justifyContent?: string }
                    | undefined)?.justifyContent === 'flex-end',
        );

        expect(overlay).toBeTruthy();
    });

    it('renders a 40×4 grabber inside the sheet container above the children.', () => {
        const { root } = render(
            <Sheet visible onRequestClose={() => {}}>
                <Text>Sheet body</Text>
            </Sheet>,
        );

        const grabbers = root.findAll(node => {
            if (typeof node.type !== 'string') return false;
            const style = StyleSheet.flatten(node.props.style as Parameters<typeof StyleSheet.flatten>[0]) as
                | { width?: number; height?: number; alignSelf?: string }
                | undefined;
            return style?.width === 40 && style?.height === 4 && style?.alignSelf === 'center';
        });

        expect(grabbers).toHaveLength(1);
    });

    it('exposes the caller-provided accessibility label on the container.', () => {
        render(
            <Sheet visible onRequestClose={() => {}} accessibilityLabel='Run zone'>
                <Text>Sheet body</Text>
            </Sheet>,
        );

        expect(screen.getByLabelText('Run zone')).toBeOnTheScreen();
    });
});
