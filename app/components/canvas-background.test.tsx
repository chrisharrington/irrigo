import { render, screen } from '@testing-library/react-native';
import { StyleSheet, Text } from 'react-native';
import { Stop } from 'react-native-svg';

import {
    BLUE_GLOW_COLOR,
    BLUE_GLOW_OPACITY,
    CanvasBackground,
    GREEN_GLOW_COLOR,
    GREEN_GLOW_OPACITY,
} from './canvas-background';

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

    it('exposes glow hex colors with alpha split into stopOpacity (renderer-safe form).', () => {
        // Regression guard: prior implementation baked alpha into rgba() on
        // `stopColor`, which `react-native-svg` 15.x does not honor on
        // Android — the canvas rendered as a saturated green/blue gradient
        // instead of a near-black backdrop with subtle tints.
        expect(GREEN_GLOW_COLOR).toMatch(/^#[0-9A-Fa-f]{6}$/);
        expect(BLUE_GLOW_COLOR).toMatch(/^#[0-9A-Fa-f]{6}$/);
        expect(GREEN_GLOW_OPACITY).toBeLessThan(0.2);
        expect(BLUE_GLOW_OPACITY).toBeLessThan(0.2);
    });

    it('renders each gradient with the inner stop using stopOpacity, not rgba alpha in stopColor.', () => {
        const { root } = render(
            <CanvasBackground>
                <Text>child</Text>
            </CanvasBackground>,
        );

        const stops = root.findAllByType(Stop);
        expect(stops.length).toBe(4);

        for (const stop of stops) {
            const stopColor = stop.props.stopColor as string;
            expect(stopColor).not.toContain('rgba');
            expect(stopColor).toMatch(/^#[0-9A-Fa-f]{6}$/);
            expect(stop.props.stopOpacity).toBeDefined();
        }
    });
});
