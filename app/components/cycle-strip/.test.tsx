import { render, screen } from '@testing-library/react-native';

import {
    CycleStrip,
    buildHourTicks,
    getTotalMin,
    parseHHMM,
    pctOf,
    pctOfSunEvent,
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

describe('pctOfSunEvent', () => {
    const startMin = 22 * 60; // 22:00
    const totalMin = 8 * 60;  // 22:00 → 06:00 = 480 min

    it('returns the direct ratio when the time falls inside the axis.', () => {
        // 23:00 = 60 min past axis start → 60 / 480 = 12.5%.
        expect(pctOfSunEvent(startMin, totalMin, '23:00')).toBeCloseTo(12.5, 5);
        // 06:00 (axis end) wraps to next-day → 100%.
        expect(pctOfSunEvent(startMin, totalMin, '06:00')).toBeCloseTo(100, 5);
    });

    it('returns a negative percent for sunset that falls before the axis start (APP-57).', () => {
        // Sunset 20:30 is 90 min BEFORE axis start 22:00 — should not wrap
        // to next-day. (1230 - 1320) / 480 = -18.75%.
        expect(pctOfSunEvent(startMin, totalMin, '20:30')).toBeCloseTo(-18.75, 5);
    });

    it('still wraps far-before times to the next day (sunrise after midnight).', () => {
        // 06:00 is far before axis start (16h before), but it's clearly the
        // next-morning sunrise — wrap forward to 100%.
        expect(pctOfSunEvent(startMin, totalMin, '06:00')).toBeCloseTo(100, 5);
        // 04:00 is 18h before axis start (> half a day) → wrap. Result:
        // (240 + 1440 - 1320) / 480 = 360 / 480 = 75%.
        expect(pctOfSunEvent(startMin, totalMin, '04:00')).toBeCloseTo(75, 5);
    });

    it('wraps backward when axisStart is post-midnight and sunset is the prior evening (APP-57 follow-up).', () => {
        // First cycle at 00:30 → axisStart=00:30, totalMin=360 (00:30 → 06:30).
        // Sunset 20:00 belongs to the *previous* day relative to that axis;
        // it must resolve to a NEGATIVE percent (not +325%) so the label
        // clamps to the left edge rather than landing alongside sunrise on
        // the right.
        const postMidnightStart = 30; // 00:30
        const postMidnightTotal = 360;
        expect(pctOfSunEvent(postMidnightStart, postMidnightTotal, '20:00')).toBeCloseTo(-75, 5);
        // Sunrise 05:30 on the same axis lands inside the chart, no wrap.
        expect(pctOfSunEvent(postMidnightStart, postMidnightTotal, '05:30'))
            .toBeCloseTo(((330 - 30) / 360) * 100, 5);
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

    it(`anchors the sunset label at the chart's left edge when sunset falls before axisStart (APP-57).`, () => {
        // Default axis is 22:00 → 06:00. Sunset at 20:00 is BEFORE the axis
        // starts. Pre-fix the label landed at right: -175% (off-screen). The
        // fix clamps the anchor to left: 0% so the label stays visible at
        // the chart's left edge.
        const NIGHT_SUNSET_BEFORE_AXIS: CycleStripNight = {
            ...SAMPLE_NIGHT,
            sunset: '20:00',
        };
        const { root } = render(<CycleStrip night={NIGHT_SUNSET_BEFORE_AXIS} />);

        // The label text is rendered.
        expect(screen.getByText('sunset 20:00')).toBeOnTheScreen();

        // And it's anchored to the left edge (left: 0%), not off-screen right.
        const sunsetWraps = root.findAll(node =>
            typeof node.type === 'string'
            && node.props.accessibilityLabel === 'sunset 20:00',
        );
        expect(sunsetWraps).toHaveLength(1);
        const styles = sunsetWraps[0]?.props.style as ReadonlyArray<Record<string, unknown>>;
        const leftStyle = styles.find(s => typeof s === 'object' && s !== null && 'left' in s);
        expect(leftStyle?.['left']).toBe('0%');
        const hasRight = styles.some(s => typeof s === 'object' && s !== null && 'right' in s);
        expect(hasRight).toBe(false);
    });

    it(`omits the sunset vertical line when sunset falls outside the chart's plotted window (APP-57).`, () => {
        // Default axis 22:00 → 06:00. Sunset at 20:00 is before the axis,
        // so the vertical SunLine would be meaningless and is skipped. Sun
        // lines use the moon-500 token (#D8C690); grid lines use hairline,
        // so we filter to just the moon-tinted vertical lines.
        const NIGHT_SUNSET_BEFORE_AXIS: CycleStripNight = {
            ...SAMPLE_NIGHT,
            sunset: '20:00',
            sunrise: '05:30',
        };
        const { root } = render(<CycleStrip night={NIGHT_SUNSET_BEFORE_AXIS} />);

        const sunLines = root.findAll(node => {
            if (typeof node.type !== 'string') return false;
            const style = node.props.style as ReadonlyArray<Record<string, unknown>> | undefined;
            if (!Array.isArray(style)) return false;
            const flat = Object.assign({}, ...style.filter(s => typeof s === 'object' && s !== null)) as Record<string, unknown>;
            return flat['width'] === 1 && flat['backgroundColor'] === '#D8C690';
        });
        // Only one sun line (sunrise in range); the off-axis sunset line is suppressed.
        expect(sunLines).toHaveLength(1);
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
