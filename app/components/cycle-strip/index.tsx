import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Line, Path } from 'react-native-svg';

import { FontFamily } from '@/constants/fonts';
import config from '@/tailwind.config';

const colors = config.theme.extend.colors;

const MINUTES_PER_DAY = 1440;
const DEFAULT_AXIS_START = '22:00';
const DEFAULT_AXIS_END = '06:00';

/**
 * Visual density of the cycle strip. `compact` is the Home hero treatment
 * (smaller lanes, 2-hour tick step); `full` is the Schedule detail treatment.
 */
export type CycleStripVariant = 'full' | 'compact';

/**
 * One cycle that fires (or is planned) during the irrigation night.
 */
export type CycleStripCycle = {
    /** Start time as `HH:MM` (24-hour, site-local). */
    start: string;

    /** Duration in minutes. */
    durMin: number;
};

/**
 * A single zone with its visual style and the cycles it owns for the night.
 */
export type CycleStripZone = {
    /** Display name shown in the legend and accessibility announcement. */
    name: string;

    /** Solid color for the lane wash and cycle pulses. */
    color: string;

    /** Outer-glow color for the cycle pulse `boxShadow`. */
    glow: string;

    /** Cycles fired (or planned) for this zone during the night. */
    cycles: ReadonlyArray<CycleStripCycle>;
};

/**
 * Night-level chart inputs: axis bounds, sun moments, and the zones to plot.
 */
export type CycleStripNight = {
    /** Optional. `HH:MM` start of the chart axis. Defaults to `'22:00'`. */
    axisStart?: string;

    /** Optional. `HH:MM` end of the chart axis. Defaults to `'06:00'`. */
    axisEnd?: string;

    /** Required. `HH:MM` site-local sunset. */
    sunset: string;

    /** Required. `HH:MM` site-local sunrise. */
    sunrise: string;

    /** Required. Zones with cycles to render. */
    zones: ReadonlyArray<CycleStripZone>;
};

/**
 * Props for the `CycleStrip` Gantt primitive.
 */
export type CycleStripProps = {
    /** Required. Night data — axis bounds, sun moments, zones + cycles. */
    night: CycleStripNight;

    /** Optional. Visual density. `compact` for Home hero; `full` for Schedule detail. Defaults to `full`. */
    variant?: CycleStripVariant;

    /** Optional. Accessibility label for the chart container. Defaults to `'Irrigation cycle chart'`. */
    accessibilityLabel?: string;
};

/**
 * Parses an `HH:MM` 24-hour string into minutes-past-midnight. Throws when
 * the input doesn't match the expected shape — the chart needs every input
 * to round-trip cleanly, so a silent fallback would mask wrong data.
 */
export function parseHHMM(value: string): number {
    const match = /^(\d{1,2}):(\d{2})$/.exec(value);
    if (!match) throw new Error(`cycle-strip: invalid HH:MM string ${JSON.stringify(value)}.`);
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
        throw new Error(`cycle-strip: HH:MM out of range ${JSON.stringify(value)}.`);
    }
    return hours * 60 + minutes;
}

/**
 * Width of the chart in minutes. Wraps past midnight when the end is at or
 * before the start (e.g. `22:00 → 06:00` returns 480).
 */
export function getTotalMin(startMin: number, endMin: number): number {
    return endMin > startMin ? endMin - startMin : endMin + MINUTES_PER_DAY - startMin;
}

/**
 * Percentage position of `hhmm` along the chart, anchored to the axis start.
 * Wraps any time that falls below `startMin` to the next day, so a cycle
 * starting at `01:30` with a `22:00`-anchored axis is plotted at ~44%.
 */
export function pctOf(startMin: number, totalMin: number, hhmm: string): number {
    let m = parseHHMM(hhmm);
    if (m < startMin) m += MINUTES_PER_DAY;
    return ((m - startMin) / totalMin) * 100;
}

/**
 * Percentage width of a cycle of `durMin` minutes against the total chart
 * width. Pure ratio, no clamping — callers apply a CSS `max(...)` so a tiny
 * cycle still renders as a visible pulse.
 */
export function widthPctOf(totalMin: number, durMin: number): number {
    return (durMin / totalMin) * 100;
}

/**
 * One hour tick on the axis.
 */
export type HourTick = {
    /** Hour-of-day (0–23) — the integer to format. */
    hour: number;

    /** Horizontal position as a 0–100 percentage of the chart width. */
    leftPct: number;
};

/**
 * Hour-tick positions from the axis start through the axis end, stepping by
 * `stepH` hours. The first tick lands on the first whole hour ≥ `startMin`.
 */
export function buildHourTicks({
    startMin,
    totalMin,
    stepH,
}: { startMin: number; totalMin: number; stepH: number }): ReadonlyArray<HourTick> {
    const ticks: HourTick[] = [];
    const firstTick = Math.ceil(startMin / 60) * 60;
    for (let m = firstTick; m <= startMin + totalMin; m += stepH * 60) {
        const hour = Math.floor(m / 60) % 24;
        const leftPct = ((m - startMin) / totalMin) * 100;
        ticks.push({ hour, leftPct });
    }
    return ticks;
}

/**
 * The Irrigo CycleStrip Gantt — visualises a single irrigation night. Plots
 * each zone's cycles against an hour axis (defaults `22:00 → 06:00`),
 * annotates sunset and sunrise with vertical lines and half-sun labels, and
 * separates each zone into its own lane. The `compact` variant is the Home
 * hero treatment; `full` is the Schedule detail treatment.
 */
export function CycleStrip({
    night,
    variant = 'full',
    accessibilityLabel = 'Irrigation cycle chart',
}: CycleStripProps) {
    const compact = variant === 'compact';
    const stepH = compact ? 2 : 1;
    const laneHeight = compact ? 16 : 20;
    const laneGap = compact ? 6 : 8;
    const legendGap = compact ? 10 : 16;

    const startMin = parseHHMM(night.axisStart ?? DEFAULT_AXIS_START);
    const endMin = parseHHMM(night.axisEnd ?? DEFAULT_AXIS_END);
    const totalMin = getTotalMin(startMin, endMin);

    const ticks = buildHourTicks({ startMin, totalMin, stepH });
    const sunsetPct = pctOf(startMin, totalMin, night.sunset);
    const sunrisePct = pctOf(startMin, totalMin, night.sunrise);

    return (
        <View accessibilityLabel={accessibilityLabel}>
            <View style={[styles.legend, { gap: legendGap }]}>
                {night.zones.map(zone => (
                    <View key={zone.name} style={styles.legendItem}>
                        <View
                            style={[
                                styles.legendDot,
                                {
                                    backgroundColor: zone.color,
                                    boxShadow: `0 0 8px ${zone.glow}`,
                                },
                            ]}
                        />
                        <Text style={styles.legendName}>{zone.name}</Text>
                        <Text style={styles.legendMeta}>
                            {`· ${zone.cycles.length} cycles · ${totalCycleMin(zone)} min`}
                        </Text>
                    </View>
                ))}
            </View>

            <View style={styles.axis}>
                {ticks.map((tick, i) => (
                    <AxisTickLabel key={`${tick.hour}-${tick.leftPct}`} tick={tick} isFirst={i === 0} isLast={i === ticks.length - 1} />
                ))}
            </View>

            <View style={styles.plot}>
                {ticks.map(tick => (
                    <View
                        key={`grid-${tick.hour}-${tick.leftPct}`}
                        style={[styles.gridLine, { left: `${tick.leftPct}%` }]}
                    />
                ))}

                <SunLine leftPct={sunsetPct} />
                <SunLine leftPct={sunrisePct} />

                <View style={{ gap: laneGap }}>
                    {night.zones.map(zone => (
                        <View
                            key={zone.name}
                            style={{ position: 'relative', height: laneHeight }}
                            accessibilityLabel={`${zone.name}: ${zone.cycles.length} cycles, ${totalCycleMin(zone)} minutes`}
                        >
                            <View
                                style={[
                                    styles.laneWash,
                                    { backgroundColor: zone.color },
                                ]}
                            />
                            {zone.cycles.map(cycle => (
                                <View
                                    key={`${cycle.start}-${cycle.durMin}`}
                                    style={[
                                        styles.cyclePulse,
                                        {
                                            left: `${pctOf(startMin, totalMin, cycle.start)}%`,
                                            width: `${widthPctOf(totalMin, cycle.durMin)}%`,
                                            backgroundColor: zone.color,
                                            boxShadow: `0 0 10px ${zone.glow}, inset 0 1px 0 rgba(255, 255, 255, 0.22)`,
                                        },
                                    ]}
                                />
                            ))}
                        </View>
                    ))}
                </View>
            </View>

            <View style={styles.sunLabelRow}>
                <SunLabel leftPct={sunsetPct} kind='set' time={night.sunset} />
                <SunLabel leftPct={sunrisePct} kind='rise' time={night.sunrise} />
            </View>
        </View>
    );
}

function totalCycleMin(zone: CycleStripZone): number {
    return zone.cycles.reduce((sum, cycle) => sum + cycle.durMin, 0);
}

function AxisTickLabel({ tick, isFirst, isLast }: { tick: HourTick; isFirst: boolean; isLast: boolean }) {
    // Anchor the first and last tick labels to their respective edges to
    // avoid clipping off the chart; everything in between is centred.
    const transformStyle: StyleProp<ViewStyle> = isFirst
        ? { transform: [{ translateX: 0 }] }
        : isLast
            ? undefined
            : { transform: [{ translateX: -0.5 }] };

    return (
        <View style={[styles.tickWrap, { left: `${tick.leftPct}%` }, transformStyle]}>
            <Text style={styles.tick}>
                {String(tick.hour).padStart(2, '0')}
                <Text style={styles.tickSuffix}>:00</Text>
            </Text>
        </View>
    );
}

function SunLine({ leftPct }: { leftPct: number }) {
    return <View style={[styles.sunLine, { left: `${leftPct}%` }]} />;
}

function SunLabel({ leftPct, kind, time }: { leftPct: number; kind: 'set' | 'rise'; time: string }) {
    // Past the midpoint, anchor the label's right edge to the line so it
    // never falls off the end of the chart.
    const alignRight = leftPct > 50;
    const labelText = `${kind === 'set' ? 'sunset' : 'sunrise'} ${time}`;

    return (
        <View
            style={[
                styles.sunLabelWrap,
                { left: `${leftPct}%` },
                alignRight ? styles.sunLabelWrapRight : undefined,
            ]}
            accessibilityLabel={labelText}
        >
            <SunGlyph kind={kind} />
            <Text style={styles.sunLabelText}>{labelText}</Text>
        </View>
    );
}

function SunGlyph({ kind }: { kind: 'set' | 'rise' }) {
    return (
        <Svg width={13} height={9} viewBox='0 0 13 9' fill='none'>
            <Path d='M1.5 8 a 5 5 0 0 1 10 0 Z' fill={colors['moon-500']} opacity={0.85} />
            <Line x1={0} y1={8.5} x2={13} y2={8.5} stroke={colors['moon-500']} strokeWidth={0.8} opacity={0.6} />
            {kind === 'set' ? (
                <Path
                    d='M6.5 2.5 v 3 M5 4 l 1.5 1.5 l 1.5 -1.5'
                    stroke={colors['moon-500']}
                    strokeWidth={1}
                    strokeLinecap='round'
                    fill='none'
                />
            ) : (
                <Path
                    d='M6.5 5.5 v -3 M5 4 l 1.5 -1.5 l 1.5 1.5'
                    stroke={colors['moon-500']}
                    strokeWidth={1}
                    strokeLinecap='round'
                    fill='none'
                />
            )}
        </Svg>
    );
}

const styles = StyleSheet.create({
    legend: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        marginBottom: 10,
    },
    legendItem: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    legendDot: {
        width: 10,
        height: 10,
        borderRadius: 4,
    },
    legendName: {
        fontFamily: FontFamily.sansMedium,
        fontSize: 12,
        lineHeight: 12,
        color: colors.fg,
    },
    legendMeta: {
        fontFamily: FontFamily.monoMedium,
        fontSize: 11,
        lineHeight: 13.2,
        color: colors['fg-muted'],
    },
    axis: {
        position: 'relative',
        height: 16,
        marginBottom: 4,
    },
    tickWrap: {
        position: 'absolute',
        top: 0,
    },
    tick: {
        fontFamily: FontFamily.monoMedium,
        fontSize: 11,
        lineHeight: 13.2,
        color: colors['fg-dim'],
    },
    tickSuffix: {
        opacity: 0.5,
    },
    plot: {
        position: 'relative',
        paddingVertical: 10,
        borderTopWidth: 1,
        borderBottomWidth: 1,
        borderColor: colors.hairline,
    },
    gridLine: {
        position: 'absolute',
        top: 0,
        bottom: 0,
        width: 1,
        backgroundColor: colors.hairline,
        opacity: 0.55,
    },
    sunLine: {
        position: 'absolute',
        top: 0,
        bottom: 0,
        width: 1,
        backgroundColor: colors['moon-500'],
        opacity: 0.55,
    },
    laneWash: {
        ...StyleSheet.absoluteFillObject,
        opacity: 0.07,
        borderRadius: 4,
    },
    cyclePulse: {
        position: 'absolute',
        top: 0,
        bottom: 0,
        minWidth: 6,
        borderRadius: 4,
    },
    sunLabelRow: {
        position: 'relative',
        height: 16,
        marginTop: 6,
    },
    sunLabelWrap: {
        position: 'absolute',
        top: 0,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
    },
    sunLabelWrapRight: {
        transform: [{ translateX: -1 }],
    },
    sunLabelText: {
        fontFamily: FontFamily.monoMedium,
        fontSize: 11,
        lineHeight: 11,
        color: colors['moon-500'],
    },
});
