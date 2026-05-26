import { render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { DayDots } from '.';

type FlatStyle = {
    width?: number;
    height?: number;
    backgroundColor?: string;
};

const ALL_ON: ReadonlyArray<boolean> = [true, true, true, true, true, true, true];
// Sun-first encoding: Mon, Wed, Fri = [Sun=F, Mon=T, Tue=F, Wed=T, Thu=F, Fri=T, Sat=F].
const MWF_ONLY: ReadonlyArray<boolean> = [false, true, false, true, false, true, false];

function findDots(root: ReturnType<typeof render>['root']) {
    return root.findAll(node => {
        if (typeof node.type !== 'string') return false;
        if (node.type !== 'View') return false;
        const flat = StyleSheet.flatten(node.props.style as Parameters<typeof StyleSheet.flatten>[0]) as FlatStyle;
        return flat.width !== undefined && flat.width === flat.height && flat.width <= 12;
    });
}

describe('DayDots', () => {
    it('renders 7 dots, one per day.', () => {
        const { root } = render(<DayDots days={ALL_ON} />);

        expect(findDots(root)).toHaveLength(7);
    });

    it('paints active days with the accent fill and inactive days with the ink-500 fill.', () => {
        const { root } = render(<DayDots days={MWF_ONLY} />);

        const dots = findDots(root);
        const fills = dots.map(node => {
            const flat = StyleSheet.flatten(node.props.style as Parameters<typeof StyleSheet.flatten>[0]) as FlatStyle;
            return flat.backgroundColor;
        });

        // Sun-first: Sun=off, Mon=on, Tue=off, Wed=on, Thu=off, Fri=on, Sat=off.
        expect(fills[0]).toBe('#232E29');
        expect(fills[1]).toBe('#5ece48');
        expect(fills[2]).toBe('#232E29');
        expect(fills[3]).toBe('#5ece48');
        expect(fills[4]).toBe('#232E29');
        expect(fills[5]).toBe('#5ece48');
        expect(fills[6]).toBe('#232E29');
    });

    it('respects a custom size override.', () => {
        const { root } = render(<DayDots days={ALL_ON} size={10} />);

        const dots = findDots(root);
        for (const dot of dots) {
            const flat = StyleSheet.flatten(dot.props.style as Parameters<typeof StyleSheet.flatten>[0]) as FlatStyle;
            expect(flat.width).toBe(10);
            expect(flat.height).toBe(10);
        }
    });

    it('respects a custom gap override on the outer row.', () => {
        const { root } = render(<DayDots days={ALL_ON} gap={8} />);

        // The root View carries the row layout and the `gap` token.
        const flat = StyleSheet.flatten(root.props.style as Parameters<typeof StyleSheet.flatten>[0]) as { gap?: number };
        expect(flat.gap).toBe(8);
    });
});
