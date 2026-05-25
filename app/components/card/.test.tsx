import { render, screen } from '@testing-library/react-native';
import { StyleSheet, Text } from 'react-native';

import { TILE_GRADIENT_COLORS } from '@/components/tile-gradient';
import { Card } from '.';

type FlatStyle = {
    padding?: number;
    borderRadius?: number;
    borderWidth?: number;
    borderColor?: string;
    boxShadow?: string;
};

// React Native processes colour values into ARGB integers before they reach
// the native LinearGradient. Convert hex constants the same way so the
// gradient-stop assertions stay readable.
function processedColor(hex: string): number {
    return parseInt('FF' + hex.slice(1), 16);
}

describe('Card', () => {
    it('renders its children.', () => {
        render(
            <Card>
                <Text>Inside card</Text>
            </Card>,
        );

        expect(screen.getByText('Inside card')).toBeOnTheScreen();
    });

    it('defaults to the surface variant — surface gradient, 16px padding, 4px radius, no shadow.', () => {
        const { root } = render(
            <Card>
                <Text>Body</Text>
            </Card>,
        );

        const style = StyleSheet.flatten(root.props.style) as FlatStyle;

        expect(root.props.colors).toEqual(TILE_GRADIENT_COLORS.surface.map(processedColor));
        expect(style.padding).toBe(16);
        expect(style.borderRadius).toBe(4);
        expect(style.borderWidth).toBe(1);
        expect(style.boxShadow).toBeUndefined();
    });

    it('applies the elevated variant — elevated gradient, 20px padding, shadow-2 inset highlight.', () => {
        const { root } = render(
            <Card variant='elevated'>
                <Text>Body</Text>
            </Card>,
        );

        const style = StyleSheet.flatten(root.props.style) as FlatStyle;

        expect(root.props.colors).toEqual(TILE_GRADIENT_COLORS.elevated.map(processedColor));
        expect(style.padding).toBe(20);
        expect(style.borderRadius).toBe(4);
        expect(style.boxShadow).toContain('rgba(0, 0, 0, 0.45)');
        expect(style.boxShadow).toContain('inset');
    });

    it('layers the accent-glow ring on top of the surface variant when `glow` is on.', () => {
        const { root } = render(
            <Card glow>
                <Text>Body</Text>
            </Card>,
        );

        const style = StyleSheet.flatten(root.props.style) as FlatStyle;

        expect(style.boxShadow).toContain('rgba(111, 227, 155, 0.28)');
        expect(style.boxShadow).toContain('inset');
    });

    it('layers the accent-glow ring on top of the elevated shadow when both are on.', () => {
        const { root } = render(
            <Card variant='elevated' glow>
                <Text>Body</Text>
            </Card>,
        );

        const style = StyleSheet.flatten(root.props.style) as FlatStyle;

        // Both the shadow-2 ambient drop and the glow-accent ring must be in
        // the composed boxShadow string.
        expect(style.boxShadow).toContain('rgba(0, 0, 0, 0.45)');
        expect(style.boxShadow).toContain('rgba(111, 227, 155, 0.28)');
    });

    it('merges the caller-provided style override onto the container.', () => {
        const { root } = render(
            <Card style={{ marginTop: 42 }}>
                <Text>Body</Text>
            </Card>,
        );

        const style = StyleSheet.flatten(root.props.style) as FlatStyle & { marginTop?: number };

        expect(style.marginTop).toBe(42);
    });
});
