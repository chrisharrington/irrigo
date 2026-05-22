import { render, screen } from '@testing-library/react-native';
import { StyleSheet, Text } from 'react-native';

import { CanvasBackground } from './canvas-background';

describe('CanvasBackground', () => {
    it('renders under the default `Irrigo canvas` accessibility label and passes children through.', () => {
        render(
            <CanvasBackground>
                <Text>Welcome to Irrigo.</Text>
            </CanvasBackground>,
        );

        expect(screen.getByLabelText('Irrigo canvas')).toBeOnTheScreen();
        expect(screen.getByText('Welcome to Irrigo.')).toBeOnTheScreen();
    });

    it('honors a custom accessibility label.', () => {
        render(
            <CanvasBackground accessibilityLabel='canvas root'>
                <Text>child</Text>
            </CanvasBackground>,
        );

        expect(screen.getByLabelText('canvas root')).toBeOnTheScreen();
    });

    it('paints the canvas base color (#06090A) on the root view.', () => {
        render(
            <CanvasBackground>
                <Text>child</Text>
            </CanvasBackground>,
        );

        const root = screen.getByLabelText('Irrigo canvas');
        const style = StyleSheet.flatten(root.props.style) as { backgroundColor?: string };
        expect(style.backgroundColor).toBe('#06090A');
    });
});
