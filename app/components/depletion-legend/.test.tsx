import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { DepletionLegend } from '.';

describe('DepletionLegend', () => {
    it('renders the three band labels under the default `Soil moisture legend` accessibility label.', () => {
        render(<DepletionLegend />);

        expect(screen.getByLabelText('Soil moisture legend')).toBeOnTheScreen();
        expect(screen.getByText('On track')).toBeOnTheScreen();
        expect(screen.getByText('Approaching limit')).toBeOnTheScreen();
        expect(screen.getByText('Limit exceeded')).toBeOnTheScreen();
    });

    it('paints each band swatch with the matching Battery tone color.', () => {
        render(<DepletionLegend />);

        const swatches = ['ok', 'warn', 'danger'] as const;
        // Same hexes as `Battery`'s TONE_COLOR map (`accent`, `warn`, `danger`).
        const expected: Record<typeof swatches[number], string> = {
            ok: '#5ece48',
            warn: '#FFBE6B',
            danger: '#FF6B7B',
        };
        for (const tone of swatches) {
            const dot = screen.getByLabelText(`${tone} swatch`);
            const style = StyleSheet.flatten(dot.props.style) as { backgroundColor?: string };
            expect(style.backgroundColor).toBe(expected[tone]);
        }
    });

    it('honors a caller-provided accessibility label.', () => {
        render(<DepletionLegend accessibilityLabel='Color key' />);

        expect(screen.getByLabelText('Color key')).toBeOnTheScreen();
    });
});
