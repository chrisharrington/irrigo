import { render, screen } from '@testing-library/react-native';

import { BrandGlyph } from './brand-glyph';

describe('BrandGlyph', () => {
    it('renders under the default `Irrigo` accessibility label.', () => {
        render(<BrandGlyph />);

        expect(screen.getByLabelText('Irrigo')).toBeOnTheScreen();
    });

    it('honors a custom accessibility label.', () => {
        render(<BrandGlyph accessibilityLabel='Irrigo brand mark' />);

        expect(screen.getByLabelText('Irrigo brand mark')).toBeOnTheScreen();
    });

    it('reflects the size prop on the rendered SVG.', () => {
        render(<BrandGlyph size={64} />);

        const svg = screen.getByLabelText('Irrigo');
        expect(svg.props.width).toBe(64);
        expect(svg.props.height).toBe(64);
    });
});
