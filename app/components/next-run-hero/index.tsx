import { StyleSheet, Text, View } from 'react-native';

import type { NextRunDto, NextRunState } from '@/api/types/next-run';
import { Badge, type BadgeTone } from '@/components/badge';
import { FontFamily } from '@/constants/fonts';
import { formatCycleWindow, formatEndsAt, formatNextRunDate, formatTimeOfDay } from '@/lib/relative-time';
import { getSiteTimezone } from '@/lib/site-timezone';
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

    /** Optional. Reference instant for the subtitle's date prefix. Defaults to `new Date()`. */
    now?: Date;
};

/**
 * Home-screen hero card showing the next irrigation run. Big mono time in
 * the accent colour, subtitle of zone order + cycle count + ends time,
 * status badge, and a per-zone schedule list (one line per zone in run
 * order). Renders a quiet empty-state card when the system has no runs
 * queued.
 */
export function NextRunHero({ nextRun, siteTimezone, now }: NextRunHeroProps) {
    const resolvedTimezone = siteTimezone ?? getSiteTimezone();
    const resolvedNow = now ?? new Date();

    const isIdle = nextRun.state === 'idle';

    if (isIdle || nextRun.startTime === null) {
        return (
            <View style={[styles.card, styles.cardEmpty]} accessibilityLabel='No runs queued'>
                <Text style={[styles.eyebrow, { color: colors['fg-muted'] }]}>Next run</Text>
                <Text style={styles.emptyTitle}>No runs queued.</Text>
                <Text style={styles.emptySub}>{subtitleForIdle(nextRun.state)}</Text>
            </View>
        );
    }

    const timeOfDay = formatTimeOfDay(nextRun.startTime, resolvedTimezone);
    const dateLabel = formatNextRunDate(nextRun.startTime, resolvedTimezone, resolvedNow);
    const endsLabel = nextRun.endsAt !== null ? `ends ${formatEndsAt(nextRun.endsAt, resolvedTimezone)}` : null;
    const zoneOrder = nextRun.zoneOrder.length > 0 ? nextRun.zoneOrder.join(', then ') : 'No zones';
    const cyclesLabel = `${nextRun.totalCycles} ${nextRun.totalCycles === 1 ? 'cycle' : 'cycles'}`;
    const subtitleParts: string[] = [];
    if (dateLabel !== '') subtitleParts.push(dateLabel);
    subtitleParts.push(zoneOrder, cyclesLabel);
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

                <Badge tone={badgeToneForState(nextRun.state)}>{badgeLabelForState(nextRun.state)}</Badge>
            </View>

            {nextRun.zones.length > 0 && (
                <View style={styles.scheduleListWrap}>
                    {nextRun.zones.map(zone => (
                        <Text key={zone.slug} style={styles.scheduleLine}>
                            {zone.name} zone: {zone.cycles.map(c => formatCycleWindow(c.start, c.durMin)).join(', ')}
                        </Text>
                    ))}
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
        case 'scheduled':
            return 'Scheduled';
        case 'firing':
            return 'Firing';
        case 'skipped-rain':
            return 'Skipped rain';
        case 'skipped-manual':
            return 'Skipped';
        case 'idle':
            return 'Idle';
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
    scheduleListWrap: {
        marginTop: 4,
        gap: 4,
    },
    scheduleLine: {
        fontFamily: FontFamily.monoMedium,
        fontSize: 12,
        lineHeight: 18,
        color: colors['fg-soft'],
    },
});
