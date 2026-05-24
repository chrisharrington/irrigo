import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Badge, type BadgeTone } from '@/components/badge';
import { CycleStrip, type CycleStripNight } from '@/components/cycle-strip';
import { FontFamily } from '@/constants/fonts';
import { formatEndsAt, formatTimeOfDay } from '@/lib/relative-time';
import { getSiteTimezone } from '@/lib/site-timezone';
import { paletteForZone } from '@/lib/zone-palette';
import type { NextRunDto, NextRunState } from '@/api/types/next-run';
import config from '@/tailwind.config';

const colors = config.theme.extend.colors;

/**
 * Props for the Home next-run hero.
 */
export type NextRunHeroProps = {
    /** Required. The current next-run summary returned by `GET /tonight`. */
    nextRun: NextRunDto;

    /** Optional. IANA timezone override for time formatting. Defaults to `getSiteTimezone()`. */
    siteTimezone?: string;
};

/**
 * Home-screen hero card showing the next irrigation run. Big mono time in
 * the accent colour, subtitle of zone order + cycle count + ends time,
 * status badge, and an embedded compact `CycleStrip`. Renders a quiet
 * empty-state card when the system has no runs queued.
 */
export function NextRunHero({ nextRun, siteTimezone }: NextRunHeroProps) {
    const resolvedTimezone = siteTimezone ?? getSiteTimezone();
    const cycleStripNight = useMemo<CycleStripNight | null>(() => {
        if (nextRun.zones.length === 0) return null;
        return {
            ...(nextRun.axisStart !== null ? { axisStart: nextRun.axisStart } : {}),
            ...(nextRun.axisEnd !== null ? { axisEnd: nextRun.axisEnd } : {}),
            sunset: nextRun.sunset ?? '20:00',
            sunrise: nextRun.sunrise ?? '06:00',
            zones: nextRun.zones.map((zone, index) => {
                const palette = paletteForZone(index);
                return {
                    name: zone.name,
                    color: palette.color,
                    glow: palette.glow,
                    cycles: zone.cycles,
                };
            }),
        };
    }, [nextRun.axisStart, nextRun.axisEnd, nextRun.sunset, nextRun.sunrise, nextRun.zones]);

    const isIdle = nextRun.state === 'idle';

    if (isIdle || nextRun.startTime === null) {
        return (
            <View style={[styles.card, styles.cardEmpty]} accessibilityLabel='No runs queued'>
                <Text style={[styles.eyebrow, { color: colors['fg-muted'] }]}>Next run</Text>
                <Text style={styles.emptyTitle}>No runs queued.</Text>
                <Text style={styles.emptySub}>
                    {subtitleForIdle(nextRun.state)}
                </Text>
            </View>
        );
    }

    const timeOfDay = formatTimeOfDay(nextRun.startTime, resolvedTimezone);
    const endsLabel = nextRun.endsAt !== null ? `ends ${formatEndsAt(nextRun.endsAt, resolvedTimezone)}` : null;
    const zoneOrder = nextRun.zoneOrder.length > 0 ? nextRun.zoneOrder.join(', then ') : 'No zones';
    const cyclesLabel = `${nextRun.totalCycles} ${nextRun.totalCycles === 1 ? 'cycle' : 'cycles'}`;
    const subtitleParts = [zoneOrder, cyclesLabel];
    if (endsLabel !== null) subtitleParts.push(endsLabel);
    const subtitle = subtitleParts.join(' · ');

    return (
        <View style={[styles.card, styles.cardActive]} accessibilityLabel={`Next run at ${timeOfDay}`}>
            <View style={styles.headerRow}>
                <View style={styles.headerText}>
                    <Text style={[styles.eyebrow, { color: colors.accent }]}>Next run</Text>
                    <Text style={styles.time}>{timeOfDay}</Text>
                    <Text style={styles.subtitle}>{subtitle}</Text>
                </View>

                <Badge tone={badgeToneForState(nextRun.state)}>
                    {badgeLabelForState(nextRun.state)}
                </Badge>
            </View>

            {cycleStripNight !== null && (
                <View style={styles.cycleStripWrap}>
                    <CycleStrip night={cycleStripNight} variant='compact' />
                </View>
            )}
        </View>
    );
}

function badgeToneForState(state: NextRunState): BadgeTone {
    if (state === 'scheduled' || state === 'firing') return 'active';
    if (state === 'skipped-rain' || state === 'skipped-manual') return 'warn';
    return 'neutral';
}

function badgeLabelForState(state: NextRunState): string {
    switch (state) {
        case 'scheduled': return 'Scheduled';
        case 'firing': return 'Firing';
        case 'skipped-rain': return 'Skipped rain';
        case 'skipped-manual': return 'Skipped';
        case 'idle': return 'Idle';
    }
}

function subtitleForIdle(state: NextRunState): string {
    if (state === 'skipped-rain') return 'Skipped tonight — rain forecast.';
    if (state === 'skipped-manual') return 'Skipped tonight by operator.';
    return 'All zones are within tolerance.';
}

const styles = StyleSheet.create({
    card: {
        backgroundColor: colors.elevated,
        borderWidth: 1,
        borderRadius: 4,
        padding: 18,
        gap: 16,
    },
    cardActive: {
        borderColor: colors['accent-border'],
        boxShadow: `0 0 0 1px ${colors['accent-glow']} inset`,
    },
    cardEmpty: {
        borderColor: colors.border,
    },
    headerRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        gap: 16,
    },
    headerText: {
        flex: 1,
        minWidth: 0,
    },
    eyebrow: {
        fontFamily: FontFamily.sansMedium,
        fontSize: 11,
        lineHeight: 13,
        letterSpacing: 1.54,
        textTransform: 'uppercase',
    },
    time: {
        marginTop: 6,
        fontFamily: FontFamily.displayBold,
        fontSize: 36,
        lineHeight: 36,
        letterSpacing: -0.9,
        color: colors.accent,
    },
    subtitle: {
        marginTop: 4,
        fontFamily: FontFamily.sans,
        fontSize: 12,
        lineHeight: 17,
        color: colors['fg-soft'],
    },
    emptyTitle: {
        marginTop: 6,
        fontFamily: FontFamily.displaySemibold,
        fontSize: 22,
        lineHeight: 22,
        letterSpacing: -0.22,
        color: colors.fg,
    },
    emptySub: {
        marginTop: 6,
        fontFamily: FontFamily.sans,
        fontSize: 12,
        lineHeight: 17,
        color: colors['fg-muted'],
    },
    cycleStripWrap: {
        marginTop: 4,
    },
});
