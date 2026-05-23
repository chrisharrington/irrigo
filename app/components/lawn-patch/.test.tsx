import { render, screen } from '@testing-library/react-native';
import { Path } from 'react-native-svg';

import { LawnPatch, type LawnPatchSlug } from '.';

const OUTLINE_PATH: Readonly<Record<LawnPatchSlug, string>> = {
    a: 'M4 8 C 6 4, 14 4, 18 8 C 22 6, 28 10, 28 16 C 28 22, 22 28, 16 28 C 8 28, 3 22, 4 16 C 4 12, 3 10, 4 8 Z',
    b: 'M5 7 C 9 3, 22 4, 26 9 C 30 14, 28 22, 22 27 C 14 30, 6 26, 4 18 C 3 13, 4 10, 5 7 Z',
    c: 'M6 9 C 4 5, 14 3, 20 5 C 26 8, 30 14, 26 20 C 24 26, 16 30, 10 26 C 4 22, 4 14, 6 9 Z',
};

describe('LawnPatch', () => {
    it('renders under the default `Lawn patch` accessibility label.', () => {
        render(<LawnPatch />);

        expect(screen.getByLabelText('Lawn patch')).toBeOnTheScreen();
    });

    it('honors a caller-provided accessibility label.', () => {
        render(<LawnPatch accessibilityLabel='Front lawn patch' />);

        expect(screen.getByLabelText('Front lawn patch')).toBeOnTheScreen();
    });

    it('reflects the size prop on the rendered SVG.', () => {
        render(<LawnPatch size={44} />);

        const svg = screen.getByLabelText('Lawn patch');
        expect(svg.props.width).toBe(44);
        expect(svg.props.height).toBe(44);
    });

    it.each<LawnPatchSlug>(['a', 'b', 'c'])(
        'renders the design-spec outline path for slug %s.',
        slug => {
            const { root } = render(<LawnPatch slug={slug} />);

            const paths = root.findAllByType(Path);
            // The outline is the first path; blades follow.
            expect(paths[0].props.d).toBe(OUTLINE_PATH[slug]);
        },
    );

    it('propagates the tone to the outline fill, outline stroke, and blade strokes.', () => {
        const tone = '#FF6B7B';
        const { root } = render(<LawnPatch tone={tone} />);

        const paths = root.findAllByType(Path);
        const outline = paths[0];
        const blades = paths.slice(1);

        expect(outline.props.fill).toBe(tone);
        expect(outline.props.stroke).toBe(tone);
        for (const blade of blades) {
            expect(blade.props.stroke).toBe(tone);
        }
    });

    it('renders exactly twelve grass-blade strokes on top of the outline.', () => {
        const { root } = render(<LawnPatch />);

        // Total paths = 1 outline + 12 blades.
        const paths = root.findAllByType(Path);
        expect(paths).toHaveLength(13);
    });
});
