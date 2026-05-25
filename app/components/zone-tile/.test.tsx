import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet, type ViewStyle } from 'react-native';

import { ZoneTile } from '.';
import type { ZoneSummary } from '@/api/types/zones';
import config from '@/tailwind.config';

const colors = config.theme.extend.colors;

const NOW = new Date('2026-05-24T15:00:00.000Z');

const HEALTHY_ZONE: ZoneSummary = {
    id: 'zone-001',
    slug: 'north',
    name: 'North',
    isEnabled: true,
    grassType: { name: 'Fescue' },
    soilType: { name: 'Loam' },
    areaM2: 320,
    rootDepthM: 0.18,
    allowableDepletionFraction: 0.5,
    irrigationEfficiency: 0.8,
    microclimateFactor: 1,
    precipitationRateMmPerHr: 10,
    currentDepletionMm: 14.4,
    rawMm: 32,
    // 2 days ago at NOW.
    lastFiredAt: new Date(NOW.getTime() - 2 * 24 * 60 * 60_000).toISOString(),
    lastAppliedMm: 14,
    homeAssistantEntityId: 'switch.zone_north',
    patch: 'a',
};

const PAST_RAW_ZONE: ZoneSummary = {
    ...HEALTHY_ZONE,
    id: 'zone-002',
    slug: 'east',
    name: 'East',
    currentDepletionMm: 34.1,
    rawMm: 30,
};

const NEVER_FIRED_ZONE: ZoneSummary = {
    ...HEALTHY_ZONE,
    id: 'zone-003',
    slug: 'south',
    name: 'South',
    lastFiredAt: null,
};

describe('ZoneTile', () => {
    it('renders the zone name and the grass · area summary.', () => {
        render(<ZoneTile zone={HEALTHY_ZONE} onPress={() => {}} now={NOW} />);

        expect(screen.getByText('North')).toBeOnTheScreen();
        expect(screen.getByText('Fescue · 320 m²')).toBeOnTheScreen();
    });

    it('renders depletion / raw with one decimal on depletion.', () => {
        render(<ZoneTile zone={HEALTHY_ZONE} onPress={() => {}} now={NOW} />);

        expect(screen.getByText('14.4')).toBeOnTheScreen();
        expect(screen.getByText('/ 32 mm')).toBeOnTheScreen();
    });

    it(`labels the depletion pair with a "Water needed" eyebrow so the meaning is explicit (APP-45).`, () => {
        render(<ZoneTile zone={HEALTHY_ZONE} onPress={() => {}} now={NOW} />);

        expect(screen.getByText('Water needed')).toBeOnTheScreen();
    });

    it('formats the Last ran footer using the relative-time helper.', () => {
        render(<ZoneTile zone={HEALTHY_ZONE} onPress={() => {}} now={NOW} />);

        expect(screen.getByText('Last ran 2 nights ago')).toBeOnTheScreen();
    });

    it('renders "Runs tonight" in the danger tone when depletion crosses RAW.', () => {
        render(<ZoneTile zone={PAST_RAW_ZONE} onPress={() => {}} now={NOW} />);

        expect(screen.getByText('Runs tonight')).toBeOnTheScreen();
        expect(screen.queryByText(/Last ran/)).toBeNull();
    });

    it('renders a fallback footer when the zone has never fired.', () => {
        render(<ZoneTile zone={NEVER_FIRED_ZONE} onPress={() => {}} now={NOW} />);

        expect(screen.getByText('No prior runs.')).toBeOnTheScreen();
    });

    it('fires `onPress` with the zone when the tile is tapped.', () => {
        const onPress = jest.fn();
        render(<ZoneTile zone={HEALTHY_ZONE} onPress={onPress} now={NOW} />);

        fireEvent.press(screen.getByLabelText('Open North'));

        expect(onPress).toHaveBeenCalledTimes(1);
        expect(onPress).toHaveBeenCalledWith(HEALTHY_ZONE);
    });

    it('uses the elevated background and accent-border per the APP-47 home-card standard.', () => {
        render(<ZoneTile zone={HEALTHY_ZONE} onPress={() => {}} now={NOW} />);

        const card = screen.getByLabelText('Open North');
        const style = StyleSheet.flatten(card.props.style) as ViewStyle;

        expect(style.backgroundColor).toBe(colors.elevated);
        expect(style.borderColor).toBe(colors['accent-border']);
    });
});
