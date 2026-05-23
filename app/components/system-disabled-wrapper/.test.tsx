import { render, screen } from '@testing-library/react-native';
import { StyleSheet, Text } from 'react-native';
import type { ReactTestInstance } from 'react-test-renderer';

import { SystemDisabledWrapper } from '.';

type FlatStyle = {
    opacity?: number;
    pointerEvents?: 'auto' | 'none' | 'box-only' | 'box-none';
};

describe('SystemDisabledWrapper', () => {
    it('renders its children when enabled.', () => {
        render(
            <SystemDisabledWrapper disabled={false}>
                <Text>Home content</Text>
            </SystemDisabledWrapper>,
        );

        expect(screen.getByText('Home content')).toBeOnTheScreen();
    });

    it('applies no opacity / pointer-event styling when enabled.', () => {
        const { root } = render(
            <SystemDisabledWrapper disabled={false}>
                <Text>Home content</Text>
            </SystemDisabledWrapper>,
        );

        const style = StyleSheet.flatten(root.props.style) as FlatStyle | undefined;
        expect(style?.opacity).toBeUndefined();
        expect(style?.pointerEvents).toBeUndefined();
    });

    it('renders children dimmed and not interactive when disabled.', () => {
        const { root } = render(
            <SystemDisabledWrapper disabled>
                <Text>Home content</Text>
            </SystemDisabledWrapper>,
        );

        const style = StyleSheet.flatten(root.props.style) as FlatStyle;
        expect(style.opacity).toBe(0.32);
        expect(style.pointerEvents).toBe('none');
        // Children still exist in the tree (just hidden from a11y); reach
        // through the host tree since `accessibilityElementsHidden` blocks
        // text-based queries.
        const textNodes = findText(root, 'Home content');
        expect(textNodes.length).toBeGreaterThan(0);
    });

    it('hides children from assistive tech when disabled.', () => {
        const { root } = render(
            <SystemDisabledWrapper disabled>
                <Text>Home content</Text>
            </SystemDisabledWrapper>,
        );

        expect(root.props.accessibilityElementsHidden).toBe(true);
        expect(root.props.importantForAccessibility).toBe('no-hide-descendants');
    });

    it('renders multiple children correctly in both enabled and disabled modes.', () => {
        const { rerender, root } = render(
            <SystemDisabledWrapper disabled={false}>
                <Text>First</Text>
                <Text>Second</Text>
            </SystemDisabledWrapper>,
        );

        expect(screen.getByText('First')).toBeOnTheScreen();
        expect(screen.getByText('Second')).toBeOnTheScreen();

        rerender(
            <SystemDisabledWrapper disabled>
                <Text>First</Text>
                <Text>Second</Text>
            </SystemDisabledWrapper>,
        );

        // Disabled hides children from a11y; reach via host-tree query.
        expect(findText(root, 'First').length).toBeGreaterThan(0);
        expect(findText(root, 'Second').length).toBeGreaterThan(0);
    });
});

function findText(root: ReactTestInstance, value: string): ReactTestInstance[] {
    return root.findAll(node => {
        if (typeof node.type !== 'string') return false;
        const children = node.children;
        return children.some(child => typeof child === 'string' && child === value);
    });
}
