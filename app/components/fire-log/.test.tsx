import { render, screen } from '@testing-library/react-native';
import { StyleSheet, type ViewStyle } from 'react-native';

import type { ActivityDto } from '@/api/types/activity';
import config from '@/tailwind.config';
import { FireLog } from '.';

const colors = config.theme.extend.colors;

// The test env is pinned to America/Edmonton (TZ in package.json), so
// device-local formatting reads as MDT for these warm-month fixtures.

function buildActivity(overrides?: Partial<ActivityDto>): ActivityDto {
    return {
        id: 'a-1',
        date: '2026-05-13',
        zone: { id: 'z-1', name: 'North', slug: 'north' },
        appliedDepthMm: 14,
        durationMin: 62,
        // 09:00 MDT on 2026-05-13 → 'May 13 · 9:00 am'.
        startedAt: '2026-05-13T15:00:00.000Z',
        depletionBeforeMm: 30,
        depletionAfterMm: 16,
        source: 'planner',
        ...overrides,
    };
}

describe('FireLog', () => {
    it('returns null when no rows are supplied so the caller can render its own empty state.', () => {
        const { toJSON } = render(<FireLog rows={[]} />);

        expect(toJSON()).toBeNull();
    });

    it('renders one row per activity entry.', () => {
        render(
            <FireLog
                rows={[
                    buildActivity({ id: 'a-1', appliedDepthMm: 14, durationMin: 62 }),
                    buildActivity({ id: 'a-2', appliedDepthMm: 9, durationMin: 51 }),
                ]}
            />,
        );

        expect(screen.getByText('14.0 mm · 62 min')).toBeOnTheScreen();
        expect(screen.getByText('9.0 mm · 51 min')).toBeOnTheScreen();
    });

    it('formats the headline as `{applied}.0 mm · {dur} min` (one decimal on applied).', () => {
        render(
            <FireLog
                rows={[buildActivity({ appliedDepthMm: 11.5, durationMin: 51 })]}
            />,
        );

        expect(screen.getByText('11.5 mm · 51 min')).toBeOnTheScreen();
    });

    it('formats the sub-line as `{before} → {after} mm`.', () => {
        render(
            <FireLog
                rows={[buildActivity({ depletionBeforeMm: 30, depletionAfterMm: 16 })]}
            />,
        );

        expect(screen.getByText('30 → 16 mm')).toBeOnTheScreen();
    });

    it('formats the date label via formatActivityRowDate (device-local MMM D · h:mm a) when startedAt is present.', () => {
        // 2026-05-13T15:00Z = 09:00 MDT on 2026-05-13 → 'May 13 · 9:00 am'.
        render(
            <FireLog
                rows={[buildActivity({ date: '2026-05-13', startedAt: '2026-05-13T15:00:00.000Z' })]}
            />,
        );

        expect(screen.getByText('May 13 · 9:00 am')).toBeOnTheScreen();
    });

    it('falls back to date-only `MMM D` when startedAt is null (APP-78).', () => {
        render(
            <FireLog
                rows={[buildActivity({ date: '2026-05-13', startedAt: null })]}
            />,
        );

        expect(screen.getByText('May 13')).toBeOnTheScreen();
    });

    it('inserts hairline dividers between rows but not before the first.', () => {
        const { root } = render(
            <FireLog
                rows={[
                    buildActivity({ id: 'a-1' }),
                    buildActivity({ id: 'a-2' }),
                    buildActivity({ id: 'a-3' }),
                ]}
            />,
        );

        const dividers = root.findAll(node => {
            if (typeof node.type !== 'string') return false;
            const style = StyleSheet.flatten(node.props.style) as ViewStyle | undefined;
            return style?.height === 1 && style.backgroundColor === colors.hairline;
        });

        // Three rows → exactly two dividers (between row pairs).
        expect(dividers).toHaveLength(2);
    });
});
