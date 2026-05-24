import { render, screen } from '@testing-library/react-native';

import {
    CycleStrip,
    buildHourTicks,
    getTotalMin,
    parseHHMM,
    pctOf,
    widthPctOf,
    type CycleStripNight,
} from '.';

const SAMPLE_NIGHT: CycleStripNight = {
    sunset: '20:45',
    sunrise: '05:30',
    zones: [
        {
            name: 'North',
            color: '#6FE39B',
            glow: 'rgba(111, 227, 155, 0.4)',
            cycles: [
                { start: '23:00', durMin: 15 },
                { start: '01:30', durMin: 12 },
            ],
        },
        {
            name: 'South',
            color: '#7CD4FB',
            glow: 'rgba(124, 212, 251, 0.4)',
            cycles: [
                { start: '23:30', durMin: 18 },
            ],
        },
    ],
};

describe('parseHHMM', () => {
    it('parses a valid HH:MM into minutes-past-midnight.', () => {
        expect(parseHHMM('22:30')).toBe(22 * 60 + 30);
        expect(parseHHMM('00:00')).toBe(0);
        expect(parseHHMM('23:59')).toBe(23 * 60 + 59);
    });

    it('throws on a malformed string.', () => {
        expect(() => parseHHMM('22:5')).toThrow();
        expect(() => parseHHMM('22-30')).toThrow();
        expect(() => parseHHMM('')).toThrow();
    });

    it('throws on out-of-range hours or minutes.', () => {
        expect(() => parseHHMM('24:00')).toThrow();
        expect(() => parseHHMM('12:60')).toThrow();
    });
});

describe('getTotalMin', () => {
    it('returns the simple delta when the end is past the start within the same day.', () => {
        expect(getTotalMin(22 * 60, 23 * 60)).toBe(60);
    });

    it('wraps past midnight when the end is at or before the start.', () => {
        expect(getTotalMin(22 * 60, 6 * 60)).toBe(8 * 60);
    });

    it('handles a same-hour wrap (start = end => full day).', () => {
        expect(getTotalMin(22 * 60, 22 * 60)).toBe(24 * 60);
    });
});

describe('pctOf', () => {
    it('places times after the axis start (same day) at their direct ratio.', () => {
        const startMin = 22 * 60;
        const totalMin = 8 * 60;
        expect(pctOf(startMin, totalMin, '22:30')).toBeCloseTo((30 / 480) * 100, 5);
    });

    it('wraps post-midnight times so they land in the right half of the chart.', () => {
        const startMin = 22 * 60;
        const totalMin = 8 * 60;
        // 01:00 → 25:00 internally → 3h past start → 3/8 = 37.5%.
        expect(pctOf(startMin, totalMin, '01:00')).toBeCloseTo(37.5, 5);
    });

    it('places the axis end exactly at 100%.', () => {
        const startMin = 22 * 60;
        const totalMin = 8 * 60;
        expect(pctOf(startMin, totalMin, '06:00')).toBeCloseTo(100, 5);
    });
});

describe('widthPctOf', () => {
    it('returns the pure ratio of a cycle duration against the chart width.', () => {
        expect(widthPctOf(8 * 60, 30)).toBeCloseTo((30 / 480) * 100, 5);
    });

    it('returns 0 for a zero-duration cycle.', () => {
        expect(widthPctOf(8 * 60, 0)).toBe(0);
    });
});

describe('buildHourTicks', () => {
    it('produces a tick at each whole hour from start through end (full / 1h step).', () => {
        const ticks = buildHourTicks({ startMin: 22 * 60, totalMin: 8 * 60, stepH: 1 });

        expect(ticks.map(t => t.hour)).toEqual([22, 23, 0, 1, 2, 3, 4, 5, 6]);
        expect(ticks[0]?.leftPct).toBe(0);
        expect(ticks[ticks.length - 1]?.leftPct).toBe(100);
    });

    it('uses a 2-hour step for the compact variant.', () => {
        const ticks = buildHourTicks({ startMin: 22 * 60, totalMin: 8 * 60, stepH: 2 });

        expect(ticks.map(t => t.hour)).toEqual([22, 0, 2, 4, 6]);
    });

    it('skips a tick that would land mid-hour when the axis start is not on the hour.', () => {
        // axisStart 22:15 → first tick at 23:00 → next at 24:00 (=0), 1, 2, 3, 4, 5, 6 — also includes 6:00 since 6*60 ≤ 22:15+8h=6:15.
        const ticks = buildHourTicks({ startMin: 22 * 60 + 15, totalMin: 8 * 60, stepH: 1 });

        expect(ticks.map(t => t.hour)).toEqual([23, 0, 1, 2, 3, 4, 5, 6]);
    });
});

describe('CycleStrip', () => {
    it('renders under the default accessibility label.', () => {
        render(<CycleStrip night={SAMPLE_NIGHT} />);

        expect(screen.getByLabelText('Irrigation cycle chart')).toBeOnTheScreen();
    });

    it('honors a caller-provided accessibility label.', () => {
        render(<CycleStrip night={SAMPLE_NIGHT} accessibilityLabel='Tonight schedule' />);

        expect(screen.getByLabelText('Tonight schedule')).toBeOnTheScreen();
    });

    it('renders each zone in the legend with its cycle count and total runtime.', () => {
        render(<CycleStrip night={SAMPLE_NIGHT} />);

        expect(screen.getByText('North')).toBeOnTheScreen();
        expect(screen.getByText('South')).toBeOnTheScreen();
        // North fires 2 cycles totaling 27 min; South fires 1 cycle totaling 18 min.
        expect(screen.getByText('· 2 cycles · 27 min')).toBeOnTheScreen();
        expect(screen.getByText('· 1 cycles · 18 min')).toBeOnTheScreen();
    });

    it('rounds the per-zone total runtime to whole minutes in the legend.', () => {
        // Without rounding, JS sums of `durMin` like 12.3 + 17.6 + 0.4 produce
        // floating-point noise like 30.300000000000004 — `Math.round` kills it
        // before interpolation so the legend reads cleanly as "· 3 cycles · 30 min".
        const NIGHT_WITH_FLOAT_DUR: CycleStripNight = {
            sunset: '20:45',
            sunrise: '05:30',
            zones: [
                {
                    name: 'Mixed',
                    color: '#6FE39B',
                    glow: 'rgba(111, 227, 155, 0.4)',
                    cycles: [
                        { start: '23:00', durMin: 12.3 },
                        { start: '00:30', durMin: 17.6 },
                        { start: '02:00', durMin: 0.4 },
                    ],
                },
            ],
        };

        render(<CycleStrip night={NIGHT_WITH_FLOAT_DUR} />);

        expect(screen.getByText('· 3 cycles · 30 min')).toBeOnTheScreen();
        expect(screen.getByLabelText('Mixed: 3 cycles, 30 minutes')).toBeOnTheScreen();
    });

    it('announces each lane via accessibility label with cycle count and runtime.', () => {
        render(<CycleStrip night={SAMPLE_NIGHT} />);

        expect(screen.getByLabelText('North: 2 cycles, 27 minutes')).toBeOnTheScreen();
        expect(screen.getByLabelText('South: 1 cycles, 18 minutes')).toBeOnTheScreen();
    });

    it('renders each sun label with just its text — no glyph child beside it.', () => {
        const { root } = render(<CycleStrip night={SAMPLE_NIGHT} />);

        // The label wrap previously held a `<SunGlyph />` (Svg dome + arrow)
        // next to the Text. After the cleanup, only the Text child remains.
        for (const labelText of ['sunset 20:45', 'sunrise 05:30']) {
            const wraps = root.findAll(node =>
                typeof node.type === 'string'
                && node.props.accessibilityLabel === labelText,
            );
            expect(wraps).toHaveLength(1);
            const hostChildren = (wraps[0]?.children ?? []).filter(child => typeof child !== 'string');
            expect(hostChildren).toHaveLength(1);
        }
    });

    it('anchors the sunrise label by its right edge so it never overflows the chart.', () => {
        const { root } = render(<CycleStrip night={SAMPLE_NIGHT} />);

        // Default axisEnd is '06:00' and sunrise is '05:30' — both land in the
        // right half of the chart, so the SunLabel wrap should be positioned
        // with `right`, not `left`.
        const sunriseWraps = root.findAll(node =>
            typeof node.type === 'string'
            && node.props.accessibilityLabel === 'sunrise 05:30',
        );
        expect(sunriseWraps).toHaveLength(1);
        const styles = sunriseWraps[0]?.props.style as ReadonlyArray<Record<string, unknown>>;
        const hasRight = styles.some(s => typeof s === 'object' && s !== null && 'right' in s);
        const hasLeft = styles.some(s => typeof s === 'object' && s !== null && 'left' in s);
        expect(hasRight).toBe(true);
        expect(hasLeft).toBe(false);
    });

    it('anchors a sun label by its left edge when it lands in the left half of the chart.', () => {
        // Sunset at 22:30 sits just inside the default axis start of 22:00 —
        // well within the left half — so positioning falls back to `left`.
        const NIGHT_LEFT_HALF_SUNSET: CycleStripNight = {
            ...SAMPLE_NIGHT,
            sunset: '22:30',
        };
        const { root } = render(<CycleStrip night={NIGHT_LEFT_HALF_SUNSET} />);

        const sunsetWraps = root.findAll(node =>
            typeof node.type === 'string'
            && node.props.accessibilityLabel === 'sunset 22:30',
        );
        expect(sunsetWraps).toHaveLength(1);
        const styles = sunsetWraps[0]?.props.style as ReadonlyArray<Record<string, unknown>>;
        const hasLeft = styles.some(s => typeof s === 'object' && s !== null && 'left' in s);
        const hasRight = styles.some(s => typeof s === 'object' && s !== null && 'right' in s);
        expect(hasLeft).toBe(true);
        expect(hasRight).toBe(false);
    });

    it('renders sunset and sunrise labels with their HH:MM times.', () => {
        render(<CycleStrip night={SAMPLE_NIGHT} />);

        expect(screen.getByText('sunset 20:45')).toBeOnTheScreen();
        expect(screen.getByText('sunrise 05:30')).toBeOnTheScreen();
    });

    it('renders an hour-axis label for every whole hour across the default axis.', () => {
        render(<CycleStrip night={SAMPLE_NIGHT} />);

        // Default axis 22:00 → 06:00, full variant: 9 hour ticks (22:00 .. 06:00).
        for (const h of [22, 23, 0, 1, 2, 3, 4, 5, 6]) {
            const label = `${String(h).padStart(2, '0')}:00`;
            expect(screen.getByText(label)).toBeOnTheScreen();
        }
    });

    it('renders fewer hour labels in the compact variant (2-hour step).', () => {
        render(<CycleStrip night={SAMPLE_NIGHT} variant='compact' />);

        // Compact: 22:00, 00:00, 02:00, 04:00, 06:00 (5 ticks).
        expect(screen.getByText('22:00')).toBeOnTheScreen();
        expect(screen.getByText('00:00')).toBeOnTheScreen();
        expect(screen.getByText('02:00')).toBeOnTheScreen();
        // Odd hours not rendered in compact.
        expect(screen.queryByText('23:00')).toBeNull();
        expect(screen.queryByText('01:00')).toBeNull();
    });

    it('renders one cycle pulse per cycle for each zone.', () => {
        const { root } = render(<CycleStrip night={SAMPLE_NIGHT} />);

        // Cycle pulses are absolutely-positioned Views with `minWidth: 6` —
        // the only host nodes carrying that distinctive style. North has 2,
        // South has 1, so 3 total cycle pulses.
        const pulses = root.findAll(node => {
            if (typeof node.type !== 'string') return false;
            const style = node.props.style;
            if (!Array.isArray(style)) return false;
            return style.some(s => s && typeof s === 'object' && (s as { minWidth?: number }).minWidth === 6);
        });

        expect(pulses).toHaveLength(3);
    });

    it('places a post-midnight cycle later on the axis than a pre-midnight one (wrap-aware).', () => {
        const startMin = 22 * 60;
        const totalMin = 8 * 60;

        // 23:30 is 1.5h into the chart → 18.75%.
        // 01:30 wraps to 25:30 → 3.5h into the chart → 43.75%.
        // The post-midnight cycle must land later than the pre-midnight one
        // (and well past the chart start), proving the wrap math is wired
        // through to the component.
        const preMidnight = pctOf(startMin, totalMin, '23:30');
        const postMidnight = pctOf(startMin, totalMin, '01:30');

        expect(preMidnight).toBeCloseTo(18.75, 5);
        expect(postMidnight).toBeCloseTo(43.75, 5);
        expect(postMidnight).toBeGreaterThan(preMidnight);
        expect(postMidnight).toBeGreaterThan(25);

        // Sanity: rendering the wrapped night with both variants doesn't throw.
        expect(() => render(<CycleStrip night={SAMPLE_NIGHT} />)).not.toThrow();
        expect(() => render(<CycleStrip night={SAMPLE_NIGHT} variant='compact' />)).not.toThrow();
    });
});
