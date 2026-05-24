import { useCallback, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Battery } from '@/components/battery';
import { FontFamily } from '@/constants/fonts';
import { formatLastRan } from '@/lib/relative-time';
import type { ZoneSummary } from '@/api/types/zones';
import config from '@/tailwind.config';

const colors = config.theme.extend.colors;

/**
 * Props for the Home zone tile.
 */
export type ZoneTileProps = {
    /** Required. The zone summary to display. */
    zone: ZoneSummary;

    /** Required. Fires with the zone when the tile is pressed. */
    onPress: (zone: ZoneSummary) => void;

    /** Optional. Anchor instant for the relative-time footer. Defaults to `new Date()` at render time. */
    now?: Date;
};

/**
 * One zone tile on the Home screen. Renders the zone's name + grass and
 * area summary, the depletion-vs-RAW large mono pair, the `Battery`
 * primitive, and a footer that flips to a danger-red "Runs tonight" when
 * the zone is past RAW.
 */
export function ZoneTile({ zone, onPress, now }: ZoneTileProps) {
    const handlePress = useCallback(() => onPress(zone), [onPress, zone]);
    const referenceNow = useMemo(() => now ?? new Date(), [now]);
    const pastRaw = zone.currentDepletionMm >= zone.rawMm;
    const lastRan = useMemo(
        () => formatLastRan(zone.lastFiredAt, referenceNow),
        [zone.lastFiredAt, referenceNow],
    );

    return (
        <Pressable
            onPress={handlePress}
            accessibilityRole='button'
            accessibilityLabel={`Open ${zone.name}`}
            style={styles.card}
        >
            <View style={styles.headerRow}>
                <View style={styles.headerText}>
                    <Text style={styles.name}>{zone.name}</Text>
                    <Text style={styles.summary}>{zone.grassType.name} · {zone.areaM2} m²</Text>
                </View>

                <View style={styles.depletionWrap}>
                    <Text style={[styles.depletion, pastRaw ? { color: colors.danger } : null]}>
                        {zone.currentDepletionMm.toFixed(1)}
                    </Text>
                    <Text style={styles.rawLabel}> / {zone.rawMm} mm</Text>
                </View>
            </View>

            <Battery depletion={zone.currentDepletionMm} raw={zone.rawMm} />

            <Text style={[styles.footer, pastRaw ? { color: colors.danger } : null]}>
                {pastRaw
                    ? 'Runs tonight'
                    : zone.lastFiredAt !== null
                        ? `Last ran ${lastRan}`
                        : 'No prior runs.'}
            </Text>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    card: {
        backgroundColor: colors.elevated,
        borderWidth: 1,
        borderColor: colors['accent-border'],
        borderRadius: 4,
        padding: 14,
        gap: 10,
    },
    headerRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 12,
    },
    headerText: {
        flex: 1,
        minWidth: 0,
    },
    name: {
        fontFamily: FontFamily.displaySemibold,
        fontSize: 16,
        lineHeight: 18,
        color: colors.fg,
    },
    summary: {
        marginTop: 2,
        fontFamily: FontFamily.monoMedium,
        fontSize: 11,
        lineHeight: 13,
        color: colors['fg-muted'],
    },
    depletionWrap: {
        flexDirection: 'row',
        alignItems: 'baseline',
        gap: 4,
    },
    depletion: {
        fontFamily: FontFamily.monoMedium,
        fontSize: 18,
        lineHeight: 18,
        color: colors.fg,
    },
    rawLabel: {
        fontFamily: FontFamily.monoMedium,
        fontSize: 11,
        lineHeight: 13,
        color: colors['fg-muted'],
    },
    footer: {
        fontFamily: FontFamily.monoMedium,
        fontSize: 11,
        lineHeight: 13,
        color: colors['fg-dim'],
    },
});
