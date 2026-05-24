import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Badge, type BadgeTone } from '@/components/badge';
import { CycleStrip, type CycleStripNight } from '@/components/cycle-strip';
import { FontFamily } from '@/constants/fonts';
import { formatEndsAt, formatTimeOfDay } from '@/lib/relative-time';
import { getSiteTimezone } from '@/lib/site-timezone';
import { paletteForZone } from '@/lib/zone-palette';
import type { TonightDto, TonightState } from '@/api/types/tonight';
import config from '@/tailwind.config';

const colors = config.theme.extend.colors;

/**
 * Props for the Home next-run hero.
 */
export type NextRunHeroProps = {
    /** Required. The current tonight summary returned by `GET /tonight`. */
    tonight: TonightDto;

    /** Optional. IANA timezone override for time formatting. Defaults to `getSiteTimezone()`. */
    siteTimezone?: string;
};

/**
 * Home-screen hero card showing the next irrigation run. Big mono time in
 * the accent colour, subtitle of zone order + cycle count + ends time,
 * status badge, and an embedded compact `CycleStrip`. Renders a quiet
 * empty-state card when the system has no runs queued tonight.
 */
export function NextRunHero({ tonight, siteTimezone }: NextRunHeroProps) {
    const resolvedTimezone = siteTimezone ?? getSiteTimezone();
    const cycleStripNight = useMemo<CycleStripNight | null>(() => {
        if (tonight.zones.length === 0) return null;
        return {
            ...(tonight.axisStart !== null ? { axisStart: tonight.axisStart } : {}),
            ...(tonight.axisEnd !== null ? { axisEnd: tonight.axisEnd } : {}),
            sunset: tonight.sunset ?? '20:00',
            sunrise: tonight.sunrise ?? '06:00',
            zones: tonight.zones.map((zone, index) => {
                const palette = paletteForZone(index);
                return {
                    name: zone.name,
                    color: palette.color,
                    glow: palette.glow,
                    cycles: zone.cycles,
                };
            }),
        };
    }, [tonight.axisStart, tonight.axisEnd, tonight.sunset, tonight.sunrise, tonight.zones]);

    const isIdle = tonight.state === 'idle';

    if (isIdle || tonight.startTime === null) {
        return (
            <View style={[styles.card, styles.cardEmpty]} accessibilityLabel='No runs queued tonight'>
                <Text style={[styles.eyebrow, { color: colors['fg-muted'] }]}>Tonight</Text>
                <Text style={styles.emptyTitle}>No runs queued.</Text>
                <Text style={styles.emptySub}>
                    {subtitleForIdle(tonight.state)}
                </Text>
            </View>
        );
    }

    const timeOfDay = formatTimeOfDay(tonight.startTime, resolvedTimezone);
    const endsLabel = tonight.endsAt !== null ? `ends ${formatEndsAt(tonight.endsAt, resolvedTimezone)}` : null;
    const zoneOrder = tonight.zoneOrder.length > 0 ? tonight.zoneOrder.join(', then ') : 'No zones';
    const cyclesLabel = `${tonight.totalCycles} ${tonight.totalCycles === 1 ? 'cycle' : 'cycles'}`;
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

                <Badge tone={badgeToneForState(tonight.state)}>
                    {badgeLabelForState(tonight.state)}
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

function badgeToneForState(state: TonightState): BadgeTone {
    if (state === 'scheduled' || state === 'firing') return 'active';
    if (state === 'skipped-rain' || state === 'skipped-manual') return 'warn';
    return 'neutral';
}

function badgeLabelForState(state: TonightState): string {
    switch (state) {
        case 'scheduled': return 'Scheduled';
        case 'firing': return 'Firing';
        case 'skipped-rain': return 'Skipped rain';
        case 'skipped-manual': return 'Skipped';
        case 'idle': return 'Idle';
    }
}

function subtitleForIdle(state: TonightState): string {
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
