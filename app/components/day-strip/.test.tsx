import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { DayStrip } from '.';

type FlatStyle = {
    backgroundColor?: string;
    borderColor?: string;
    color?: string;
    boxShadow?: string;
};

const ALL_ON: ReadonlyArray<boolean> = [true, true, true, true, true, true, true];
const ALL_OFF: ReadonlyArray<boolean> = [false, false, false, false, false, false, false];
// Sun-first encoding: Mon, Wed, Fri = [Sun=F, Mon=T, Tue=F, Wed=T, Thu=F, Fri=T, Sat=F].
const MWF_ONLY: ReadonlyArray<boolean> = [false, true, false, true, false, true, false];

describe('DayStrip', () => {
    it('renders one cell per day with the Sun-first label sequence.', () => {
        render(<DayStrip days={ALL_OFF} />);

        // 7 cells, labels in Sun-Sat order: S, M, T, W, T, F, S.
        expect(screen.getByLabelText('Sunday: inactive')).toBeOnTheScreen();
        expect(screen.getByLabelText('Monday: inactive')).toBeOnTheScreen();
        expect(screen.getByLabelText('Tuesday: inactive')).toBeOnTheScreen();
        expect(screen.getByLabelText('Wednesday: inactive')).toBeOnTheScreen();
        expect(screen.getByLabelText('Thursday: inactive')).toBeOnTheScreen();
        expect(screen.getByLabelText('Friday: inactive')).toBeOnTheScreen();
        expect(screen.getByLabelText('Saturday: inactive')).toBeOnTheScreen();
    });

    it('marks each active day with an `active` accessibility state.', () => {
        render(<DayStrip days={MWF_ONLY} />);

        expect(screen.getByLabelText('Sunday: inactive')).toBeOnTheScreen();
        expect(screen.getByLabelText('Monday: active')).toBeOnTheScreen();
        expect(screen.getByLabelText('Tuesday: inactive')).toBeOnTheScreen();
        expect(screen.getByLabelText('Wednesday: active')).toBeOnTheScreen();
        expect(screen.getByLabelText('Friday: active')).toBeOnTheScreen();
    });

    it('paints active cells with the accent palette and inactive cells with the surface palette.', () => {
        render(<DayStrip days={MWF_ONLY} />);

        const monStyle = StyleSheet.flatten(screen.getByLabelText('Monday: active').props.style) as FlatStyle;
        const tueStyle = StyleSheet.flatten(screen.getByLabelText('Tuesday: inactive').props.style) as FlatStyle;

        expect(monStyle.backgroundColor).toBe('rgba(111, 227, 155, 0.06)');
        expect(monStyle.borderColor).toBe('rgba(111, 227, 155, 0.4)');
        expect(tueStyle.backgroundColor).toBe('#0E1412');
        expect(tueStyle.borderColor).toBe('#232E29');
    });

    it('renders the day letters in the source order S M T W T F S.', () => {
        render(<DayStrip days={ALL_ON} />);

        // All 7 letters render. T (Tue + Thu) and S (Sun + Sat) overlap by
        // text content — query by accessibility label.
        const labels = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        for (const name of labels) {
            expect(screen.getByLabelText(`${name}: active`)).toBeOnTheScreen();
        }
    });
});
