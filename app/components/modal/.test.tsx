import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet, Text } from 'react-native';
import { BlurView } from 'expo-blur';
import type { ReactTestInstance } from 'react-test-renderer';

import { Modal } from '.';

jest.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 0, bottom: 34, left: 0, right: 0 }),
}));

// Flattened styles of every host node (string `type`) whose style satisfies
// `predicate`. Walks host nodes only — the same technique the scrim/blur tests
// use — to avoid the composite wrappers a `.parent` walk would hit.
function hostStylesMatching(
    root: ReactTestInstance,
    predicate: (style: Record<string, unknown>) => boolean,
): Record<string, unknown>[] {
    return root
        .findAll(node => typeof node.type === 'string')
        .map(node => StyleSheet.flatten(node.props.style as Parameters<typeof StyleSheet.flatten>[0]) as
            | Record<string, unknown>
            | undefined)
        .filter((style): style is Record<string, unknown> => style !== undefined && predicate(style));
}

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

    it('renders its children when visible in the bottom-sheet variant.', () => {
        render(
            <Modal visible onRequestClose={() => {}} variant='bottom-sheet'>
                <Text>Sheet body</Text>
            </Modal>,
        );

        expect(screen.getByText('Sheet body')).toBeOnTheScreen();
    });

    it('anchors the panel to the bottom of the screen in the bottom-sheet variant.', () => {
        const { root } = render(
            <Modal visible onRequestClose={() => {}} variant='bottom-sheet'>
                <Text>Sheet body</Text>
            </Modal>,
        );

        // The overlay anchors the sheet to the bottom edge.
        expect(hostStylesMatching(root, style => style['justifyContent'] === 'flex-end')).toHaveLength(1);
        expect(hostStylesMatching(root, style => style['justifyContent'] === 'center')).toHaveLength(0);
    });

    it('centres the panel by default.', () => {
        const { root } = render(
            <Modal visible onRequestClose={() => {}}>
                <Text>Dialog body</Text>
            </Modal>,
        );

        expect(hostStylesMatching(root, style => style['justifyContent'] === 'center')).toHaveLength(1);
        expect(hostStylesMatching(root, style => style['justifyContent'] === 'flex-end')).toHaveLength(0);
    });

    it('pads the bottom-sheet panel by the bottom safe-area inset so content clears the nav bar.', () => {
        const { root } = render(
            <Modal visible onRequestClose={() => {}} variant='bottom-sheet'>
                <Text>Sheet body</Text>
            </Modal>,
        );

        // The sheet panel — identified by its top-only radius — carries the
        // bottom inset (34) so its content clears the navigation bar.
        const panels = hostStylesMatching(
            root,
            style => style['borderTopLeftRadius'] === 4 && style['borderTopRightRadius'] === 4,
        );

        expect(panels).toHaveLength(1);
        expect(panels[0]['paddingBottom']).toBe(34);
    });

    it('slides the bottom-sheet variant up from the bottom (animationType "slide").', () => {
        const { root } = render(
            <Modal visible onRequestClose={() => {}} variant='bottom-sheet'>
                <Text>Sheet body</Text>
            </Modal>,
        );

        const animated = root.find(node => node.props.animationType !== undefined);

        expect(animated.props.animationType).toBe('slide');
        // Lets the sheet draw under the Android nav bar so it sits flush (APP-73).
        expect(animated.props.navigationBarTranslucent).toBe(true);
    });

    it('fades the default centred variant in (animationType "fade").', () => {
        const { root } = render(
            <Modal visible onRequestClose={() => {}}>
                <Text>Dialog body</Text>
            </Modal>,
        );

        const animated = root.find(node => node.props.animationType !== undefined);

        expect(animated.props.animationType).toBe('fade');
        // The centred dialog keeps its own window inset behaviour unchanged.
        expect(animated.props.navigationBarTranslucent).toBe(false);
    });
});
