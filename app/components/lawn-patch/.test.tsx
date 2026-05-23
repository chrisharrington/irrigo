import { render, screen } from '@testing-library/react-native';
import { Path } from 'react-native-svg';

import { LawnPatch, OUTLINE_PATH, type LawnPatchSlug } from '.';

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
