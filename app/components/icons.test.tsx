import { render, screen } from '@testing-library/react-native';
import type { ComponentType } from 'react';

import {
    Bell,
    Cal,
    Check,
    ChevL,
    ChevR,
    Drop,
    History,
    Home,
    type IconProps,
    Menu,
    More,
    Pause,
    Play,
    Refresh,
    Settings,
    X,
    Zone,
} from './icons';

const icons: ReadonlyArray<readonly [string, ComponentType<IconProps>]> = [
    ['Drop', Drop],
    ['ChevR', ChevR],
    ['ChevL', ChevL],
    ['Refresh', Refresh],
    ['Bell', Bell],
    ['More', More],
    ['Play', Play],
    ['Pause', Pause],
    ['Zone', Zone],
    ['Cal', Cal],
    ['History', History],
    ['Home', Home],
    ['Menu', Menu],
    ['X', X],
    ['Check', Check],
    ['Settings', Settings],
];

describe('Irrigo icons', () => {
    describe.each(icons)('%s', (name, Component) => {
        it('renders under the supplied accessibility label.', () => {
            render(<Component accessibilityLabel={name} />);

            expect(screen.getByLabelText(name)).toBeOnTheScreen();
        });
    });

    it('renders Drop at the default 16px size.', () => {
        render(<Drop accessibilityLabel='Drop' />);

        const svg = screen.getByLabelText('Drop');
        expect(svg.props.width).toBe(16);
        expect(svg.props.height).toBe(16);
    });

    it('renders Drop at the explicit size override.', () => {
        render(<Drop size={40} accessibilityLabel='Drop' />);

        const svg = screen.getByLabelText('Drop');
        expect(svg.props.width).toBe(40);
        expect(svg.props.height).toBe(40);
    });

    it('applies the color prop to the stroke of a stroke-based icon.', () => {
        render(<Drop color='#6FE39B' accessibilityLabel='Drop' />);

        const svg = screen.getByLabelText('Drop');
        expect(svg.props.stroke).toBe('#6FE39B');
        expect(svg.props.fill).toBe('none');
    });

    it('applies the color prop to the fill of a fill-based icon.', () => {
        render(<More color='#FF6B7B' accessibilityLabel='More' />);

        const svg = screen.getByLabelText('More');
        expect(svg.props.fill).toBe('#FF6B7B');
    });

    it('applies the color prop to the fill of the Pause icon.', () => {
        render(<Pause color='#FFBE6B' accessibilityLabel='Pause' />);

        const svg = screen.getByLabelText('Pause');
        expect(svg.props.fill).toBe('#FFBE6B');
    });

    it('honors a custom strokeWidth on a stroke-based icon.', () => {
        render(<Bell strokeWidth={2.5} accessibilityLabel='Bell' />);

        const svg = screen.getByLabelText('Bell');
        expect(svg.props.strokeWidth).toBe(2.5);
    });

    it('uses the source 1.6 stroke weight by default on the chevrons, menu, and close icons.', () => {
        render(
            <>
                <ChevR accessibilityLabel='ChevR' />
                <ChevL accessibilityLabel='ChevL' />
                <Menu accessibilityLabel='Menu' />
                <X accessibilityLabel='X' />
                <Check accessibilityLabel='Check' />
            </>,
        );

        expect(screen.getByLabelText('ChevR').props.strokeWidth).toBe(1.6);
        expect(screen.getByLabelText('ChevL').props.strokeWidth).toBe(1.6);
        expect(screen.getByLabelText('Menu').props.strokeWidth).toBe(1.6);
        expect(screen.getByLabelText('X').props.strokeWidth).toBe(1.6);
        expect(screen.getByLabelText('Check').props.strokeWidth).toBe(1.6);
    });

    it('uses the source 1.4 stroke weight by default on the rest of the stroke-based icons.', () => {
        render(
            <>
                <Drop accessibilityLabel='Drop' />
                <Refresh accessibilityLabel='Refresh' />
                <Bell accessibilityLabel='Bell' />
                <Zone accessibilityLabel='Zone' />
                <Cal accessibilityLabel='Cal' />
                <History accessibilityLabel='History' />
                <Home accessibilityLabel='Home' />
            </>,
        );

        for (const name of ['Drop', 'Refresh', 'Bell', 'Zone', 'Cal', 'History', 'Home']) {
            expect(screen.getByLabelText(name).props.strokeWidth).toBe(1.4);
        }
    });
});
