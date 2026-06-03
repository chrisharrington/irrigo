import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { StyleSheet, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { ZoneTile } from '.';
import { TILE_GRADIENT_COLORS } from '@/components/tile-gradient';
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
    isRunning: false,
    willCloseAt: null,
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
    it('renders the zone name and the grass-type summary.', () => {
        render(<ZoneTile zone={HEALTHY_ZONE} onPress={() => {}} now={NOW} />);

        expect(screen.getByText('North')).toBeOnTheScreen();
        expect(screen.getByText('Fescue')).toBeOnTheScreen();
    });

    it('renders water held / capacity with one decimal on the held figure and the mm suffix.', () => {
        // held = raw 32 − depletion 14.4 = 17.6 mm.
        render(<ZoneTile zone={HEALTHY_ZONE} onPress={() => {}} now={NOW} />);

        expect(screen.getByText('17.6 mm')).toBeOnTheScreen();
        expect(screen.getByText('/ 32 mm')).toBeOnTheScreen();
    });

    it('clamps the held figure to 0.0 mm when the zone is past RAW.', () => {
        // depletion 34.1 ≥ raw 30 → held = max(0, 30 − 34.1) = 0.
        render(<ZoneTile zone={PAST_RAW_ZONE} onPress={() => {}} now={NOW} />);

        expect(screen.getByText('0.0 mm')).toBeOnTheScreen();
        expect(screen.getByText('/ 30 mm')).toBeOnTheScreen();
    });

    it('formats the Last ran footer using the relative-time helper.', () => {
        render(<ZoneTile zone={HEALTHY_ZONE} onPress={() => {}} now={NOW} />);

        expect(screen.getByText('Last ran 2 nights ago')).toBeOnTheScreen();
    });

    it('renders "Runs next" in the danger tone when depletion crosses RAW.', () => {
        render(<ZoneTile zone={PAST_RAW_ZONE} onPress={() => {}} now={NOW} />);

        expect(screen.getByText('Runs next')).toBeOnTheScreen();
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

    it('paints the elevated gradient and accent-border on the inner TileGradient (APP-47 / APP-60).', () => {
        render(<ZoneTile zone={HEALTHY_ZONE} onPress={() => {}} now={NOW} />);

        // The Pressable is the accessibility anchor; the gradient is rendered
        // by the TileGradient child inside it and owns the visual styles
        // after the APP-60 swap.
        const card = screen.getByLabelText('Open North');
        const gradient = within(card).UNSAFE_getByType(LinearGradient);
        const style = StyleSheet.flatten(gradient.props.style) as ViewStyle;

        expect(gradient.props.colors).toEqual([...TILE_GRADIENT_COLORS.elevated]);
        expect(style.borderColor).toBe(colors['accent-border']);
    });

    // Without a `now` prop the tile drives its own clock, so the footer must
    // refresh as wall-clock time advances instead of freezing at mount. APP-87.
    describe('live clock (no now prop)', () => {
        beforeEach(() => {
            jest.useFakeTimers();
            // 2026-05-23T03:00:00Z = 21:00 MDT on 2026-05-22.
            jest.setSystemTime(new Date('2026-05-23T03:00:00.000Z'));
        });

        afterEach(() => {
            // Cancel the tile's interval without firing it post-test.
            jest.clearAllTimers();
            jest.useRealTimers();
        });

        it('refreshes the "Last ran" footer as the day rolls over.', () => {
            // Ran 23:00 MDT on 2026-05-21 — one midnight before the mounted "now".
            const zone: ZoneSummary = { ...HEALTHY_ZONE, lastFiredAt: '2026-05-22T05:00:00.000Z' };
            render(<ZoneTile zone={zone} onPress={() => {}} />);

            expect(screen.getByText('Last ran last night')).toBeOnTheScreen();

            act(() => {
                // Advance to the next evening (21:00 MDT May 23) and let one
                // interval tick fire so the tile re-reads the clock.
                jest.setSystemTime(new Date('2026-05-24T03:00:00.000Z'));
                jest.advanceTimersByTime(60_000);
            });

            expect(screen.getByText('Last ran 2 nights ago')).toBeOnTheScreen();
        });
    });
});
