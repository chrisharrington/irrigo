import { render, screen } from '@testing-library/react-native';
import { StyleSheet, View } from 'react-native';

import { Badge, type BadgeTone } from '.';

const TONE_EXPECTATIONS: Readonly<Record<BadgeTone, { text: string; border: string; dot: string }>> = {
    // Neutral is the one case where the dot deliberately stays muted while
    // the label text reads fg-soft — every other tone matches dot to text.
    neutral: { text: '#C7CFC9', border: '#232E29', dot: '#8A9690' },
    active: { text: '#5ece48', border: 'rgba(94, 206, 72, 0.4)', dot: '#5ece48' },
    warn: { text: '#FFBE6B', border: 'rgba(255, 190, 107, 0.4)', dot: '#FFBE6B' },
    danger: { text: '#FF6B7B', border: 'rgba(255, 107, 123, 0.4)', dot: '#FF6B7B' },
    info: { text: '#7CD4FB', border: 'rgba(124, 212, 251, 0.4)', dot: '#7CD4FB' },
};

function findDotSibling(container: ReturnType<typeof render>['root']) {
    // The dot is a 6×6 View sibling of the text; we identify it by its size
    // since it has no text or accessibility label of its own.
    return container.findAll(node => {
        if (node.type !== View) return false;
        const style = StyleSheet.flatten(node.props.style as Parameters<typeof StyleSheet.flatten>[0]) as
            | { width?: number; height?: number }
            | undefined;
        return style?.width === 6 && style?.height === 6;
    });
}

describe('Badge', () => {
    it('renders the children text.', () => {
        render(<Badge>Active</Badge>);

        expect(screen.getByText('Active')).toBeOnTheScreen();
    });

    it('renders the dot by default.', () => {
        const { root } = render(<Badge>Active</Badge>);

        expect(findDotSibling(root)).toHaveLength(1);
    });

    it('hides the dot when `dot={false}`.', () => {
        const { root } = render(<Badge dot={false}>Active</Badge>);

        expect(findDotSibling(root)).toHaveLength(0);
    });

    it.each(Object.entries(TONE_EXPECTATIONS) as ReadonlyArray<[BadgeTone, { text: string; border: string; dot: string }]>)(
        'applies the %s tone palette to the container border, dot, and label color.',
        (tone, expected) => {
            const { root } = render(<Badge tone={tone}>Label</Badge>);

            const container = screen.getByLabelText('Label');
            const label = screen.getByText('Label');
            const dot = findDotSibling(root)[0];

            const containerStyle = StyleSheet.flatten(container.props.style) as { borderColor?: string };
            const textStyle = StyleSheet.flatten(label.props.style) as { color?: string };
            const dotStyle = StyleSheet.flatten(dot?.props.style) as { backgroundColor?: string };

            expect(containerStyle.borderColor).toBe(expected.border);
            expect(textStyle.color).toBe(expected.text);
            expect(dotStyle.backgroundColor).toBe(expected.dot);
        },
    );

    it(`adds a green box-shadow on the dot only for the 'active' tone.`, () => {
        const { root: activeRoot, rerender } = render(<Badge tone='active'>Running</Badge>);

        const activeDot = findDotSibling(activeRoot)[0];
        const activeDotStyle = StyleSheet.flatten(activeDot?.props.style) as { boxShadow?: string };
        expect(activeDotStyle.boxShadow).toContain('#5ece48');

        rerender(<Badge tone='neutral'>Idle</Badge>);
        const neutralDot = findDotSibling(activeRoot)[0];
        const neutralDotStyle = StyleSheet.flatten(neutralDot?.props.style) as { boxShadow?: string };
        expect(neutralDotStyle.boxShadow).toBeUndefined();
    });
});
