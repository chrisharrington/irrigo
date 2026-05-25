import { StyleSheet, Text, View } from 'react-native';

import { FontFamily } from '@/constants/fonts';
import config from '@/tailwind.config';

const colors = config.theme.extend.colors;

const BANDS: ReadonlyArray<{ tone: 'ok' | 'warn' | 'danger'; label: string; color: string }> = [
    { tone: 'ok', label: 'On track', color: colors.accent },
    { tone: 'warn', label: 'Approaching limit', color: colors.warn },
    { tone: 'danger', label: 'Runs tonight', color: colors.danger },
];

export type DepletionLegendProps = {
    /** Optional. Accessibility label for the legend container. Defaults to `'Soil moisture legend'`. */
    accessibilityLabel?: string;
};

/**
 * Explains the three color bands used by the per-tile `Battery` and the
 * tile's danger-tone footer. Rendered once on the Home screen under the
 * "Zones" heading so each tile doesn't repeat the same legend chrome. The
 * dot colors mirror `Battery`'s `ok` / `warn` / `danger` tokens; the band
 * boundaries (`< 80% RAW` / `80–100%` / `≥ RAW`) match
 * `computeBatteryGeometry`'s tone thresholds.
 */
export function DepletionLegend({
    accessibilityLabel = 'Soil moisture legend',
}: DepletionLegendProps = {}) {
    return (
        <View style={styles.row} accessibilityLabel={accessibilityLabel}>
            {BANDS.map(band => (
                <View key={band.tone} style={styles.item}>
                    <View
                        accessibilityLabel={`${band.tone} swatch`}
                        style={[styles.dot, { backgroundColor: band.color }]}
                    />
                    <Text style={styles.label}>{band.label}</Text>
                </View>
            ))}
        </View>
    );
}

const styles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 12,
    },
    item: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    dot: {
        width: 8,
        height: 8,
        borderRadius: 4,
    },
    label: {
        fontFamily: FontFamily.monoMedium,
        fontSize: 11,
        lineHeight: 13,
        color: colors['fg-muted'],
    },
});
