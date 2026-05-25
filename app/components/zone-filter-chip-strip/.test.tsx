import { fireEvent, render, screen } from '@testing-library/react-native';

import { ZoneFilterChipStrip } from '.';

const ZONES = [
    { id: 'z-1', name: 'North' },
    { id: 'z-2', name: 'South' },
];

describe('ZoneFilterChipStrip', () => {
    it('renders null when the zone list is empty.', () => {
        const { toJSON } = render(
            <ZoneFilterChipStrip zones={[]} selectedZoneId={undefined} onSelect={jest.fn()} />,
        );

        expect(toJSON()).toBeNull();
    });

    it('renders the "All zones" chip plus one chip per zone.', () => {
        render(
            <ZoneFilterChipStrip zones={ZONES} selectedZoneId={undefined} onSelect={jest.fn()} />,
        );

        expect(screen.getByText('All zones')).toBeOnTheScreen();
        expect(screen.getByText('North')).toBeOnTheScreen();
        expect(screen.getByText('South')).toBeOnTheScreen();
    });

    it('marks the "All zones" chip selected when selectedZoneId is undefined.', () => {
        render(
            <ZoneFilterChipStrip zones={ZONES} selectedZoneId={undefined} onSelect={jest.fn()} />,
        );

        expect(screen.getByLabelText('Show all zones').props.accessibilityState).toMatchObject({ selected: true });
        expect(screen.getByLabelText('Filter to North').props.accessibilityState).toMatchObject({ selected: false });
        expect(screen.getByLabelText('Filter to South').props.accessibilityState).toMatchObject({ selected: false });
    });

    it('marks the matching zone chip selected and unmarks "All zones" when a zone id is supplied.', () => {
        render(
            <ZoneFilterChipStrip zones={ZONES} selectedZoneId='z-1' onSelect={jest.fn()} />,
        );

        expect(screen.getByLabelText('Show all zones').props.accessibilityState).toMatchObject({ selected: false });
        expect(screen.getByLabelText('Filter to North').props.accessibilityState).toMatchObject({ selected: true });
        expect(screen.getByLabelText('Filter to South').props.accessibilityState).toMatchObject({ selected: false });
    });

    it('fires onSelect with the zone id when a zone chip is tapped.', () => {
        const onSelect = jest.fn();
        render(
            <ZoneFilterChipStrip zones={ZONES} selectedZoneId={undefined} onSelect={onSelect} />,
        );

        fireEvent.press(screen.getByLabelText('Filter to South'));

        expect(onSelect).toHaveBeenCalledTimes(1);
        expect(onSelect).toHaveBeenCalledWith('z-2');
    });

    it('fires onSelect with undefined when the "All zones" chip is tapped.', () => {
        const onSelect = jest.fn();
        render(
            <ZoneFilterChipStrip zones={ZONES} selectedZoneId='z-1' onSelect={onSelect} />,
        );

        fireEvent.press(screen.getByLabelText('Show all zones'));

        expect(onSelect).toHaveBeenCalledTimes(1);
        expect(onSelect).toHaveBeenCalledWith(undefined);
    });
});
