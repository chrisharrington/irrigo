import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';

import { FontFamily } from '@/constants/fonts';
import config from '@/tailwind.config';

const colors = config.theme.extend.colors;

/**
 * A single chip's worth of zone metadata. The component only needs the id
 * and visible name, so callers can pass any object that satisfies it
 * (e.g. `ZoneSummary` minus the fields the chip doesn't use).
 */
export type ZoneFilterChip = {
    id: string;
    name: string;
};

/**
 * Props for the zone filter chip strip.
 */
export type ZoneFilterChipStripProps = {
    /** Required. Zones to render as filter chips, in display order. */
    zones: ReadonlyArray<ZoneFilterChip>;

    /** Required. The currently selected zone id, or `undefined` to indicate the "All zones" chip is active. */
    selectedZoneId: string | undefined;

    /** Required. Fires with the tapped zone id, or `undefined` when the user picks "All zones". */
    onSelect: (zoneId: string | undefined) => void;
};

/**
 * Horizontally-scrollable filter chip strip used above the Activity
 * screen's `FireLog`. Leads with an "All zones" chip (selected state =
 * `selectedZoneId === undefined`) followed by one chip per zone. Selected
 * chips paint with the accent treatment; the rest sit on the standard
 * surface tone. Returns `null` while the zone list is empty so the layout
 * doesn't reserve space before zones load. APP-61.
 */
export function ZoneFilterChipStrip({ zones, selectedZoneId, onSelect }: ZoneFilterChipStripProps) {
    if (zones.length === 0) return null;

    return (
        <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.strip}
            accessibilityLabel='Zone filter'
        >
            <Chip
                label='All zones'
                accessibilityLabel='Show all zones'
                selected={selectedZoneId === undefined}
                onPress={() => onSelect(undefined)}
            />
            {zones.map(zone => (
                <Chip
                    key={zone.id}
                    label={zone.name}
                    accessibilityLabel={`Filter to ${zone.name}`}
                    selected={selectedZoneId === zone.id}
                    onPress={() => onSelect(zone.id)}
                />
            ))}
        </ScrollView>
    );
}

function Chip({
    label,
    accessibilityLabel,
    selected,
    onPress,
}: {
    label: string;
    accessibilityLabel: string;
    selected: boolean;
    onPress: () => void;
}) {
    return (
        <Pressable
            onPress={onPress}
            accessibilityRole='button'
            accessibilityLabel={accessibilityLabel}
            accessibilityState={{ selected }}
            style={[styles.chip, selected ? styles.chipSelected : styles.chipUnselected]}
        >
            <Text style={[styles.label, selected ? styles.labelSelected : styles.labelUnselected]}>
                {label}
            </Text>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    strip: {
        gap: 8,
        paddingHorizontal: 20,
    },
    chip: {
        height: 28,
        paddingHorizontal: 12,
        borderWidth: 1,
        borderRadius: 4,
        alignItems: 'center',
        justifyContent: 'center',
    },
    chipSelected: {
        backgroundColor: colors['accent-tint'],
        borderColor: colors['accent-border'],
    },
    chipUnselected: {
        backgroundColor: colors.surface,
        borderColor: colors.border,
    },
    label: {
        fontFamily: FontFamily.sansMedium,
        fontSize: 12,
        lineHeight: 14,
    },
    labelSelected: {
        color: colors.accent,
    },
    labelUnselected: {
        color: colors['fg-soft'],
    },
});
