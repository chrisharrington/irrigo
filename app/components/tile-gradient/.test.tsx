import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { TILE_GRADIENT_COLORS, TileGradient } from '.';

// React Native processes colour values into ARGB integers before they reach
// the native LinearGradient. Convert our hex constants the same way so the
// assertions stay self-documenting (`processedColor('#1B231F')` vs an opaque
// `4279968543`).
function processedColor(hex: string): number {
    return parseInt('FF' + hex.slice(1), 16);
}

describe('TileGradient', () => {
    it('renders its children.', () => {
        render(
            <TileGradient>
                <Text>Inside gradient</Text>
            </TileGradient>,
        );

        expect(screen.getByText('Inside gradient')).toBeOnTheScreen();
    });

    it('defaults to the elevated colour pair when no variant is supplied.', () => {
        const { root } = render(
            <TileGradient accessibilityLabel='Elevated card'>
                <Text>Body</Text>
            </TileGradient>,
        );

        expect(root.props.colors).toEqual(TILE_GRADIENT_COLORS.elevated.map(processedColor));
    });

    it('uses the surface colour pair when variant="surface" is supplied.', () => {
        const { root } = render(
            <TileGradient variant='surface' accessibilityLabel='Surface card'>
                <Text>Body</Text>
            </TileGradient>,
        );

        expect(root.props.colors).toEqual(TILE_GRADIENT_COLORS.surface.map(processedColor));
    });
});
