import { StyleSheet, Text, View } from 'react-native';

import { FontFamily } from '@/constants/fonts';
import { SUN_FIRST_DAY_LETTERS, SUN_FIRST_DAY_NAMES } from '@/lib/schedule-format';
import config from '@/tailwind.config';

const colors = config.theme.extend.colors;

/**
 * Props for the full-width 7-day strip.
 */
export type DayStripProps = {
    /** Required. Booleans for Sun-Sat (index 0 = Sun). Length must be 7. */
    days: ReadonlyArray<boolean>;
};

/**
 * Week-at-a-glance strip used in the active-schedule hero. Each cell is a
 * 40px-tall card with a day-letter, a tiny status dot, and accent chrome
 * for active days. RN port of `DayStrip` from the design source's
 * `Mobile.jsx`.
 */
export function DayStrip({ days }: DayStripProps) {
    return (
        <View style={styles.row}>
            {SUN_FIRST_DAY_LETTERS.map((label, index) => {
                const on = days[index] === true;
                return (
                    <View
                        // eslint-disable-next-line react/no-array-index-key
                        key={index}
                        style={[
                            styles.cell,
                            on ? styles.cellOn : styles.cellOff,
                        ]}
                        accessibilityLabel={`${dayName(index)}: ${on ? 'active' : 'inactive'}`}
                    >
                        <Text style={[styles.label, { color: on ? colors.accent : colors['fg-dim'] }]}>
                            {label}
                        </Text>
                        <View
                            style={[
                                styles.dot,
                                on ? styles.dotOn : styles.dotOff,
                            ]}
                        />
                    </View>
                );
            })}
        </View>
    );
}

function dayName(index: number): string {
    return SUN_FIRST_DAY_NAMES[index] ?? 'Day';
}

const styles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        gap: 6,
    },
    cell: {
        flex: 1,
        height: 40,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 5,
        borderWidth: 1,
        borderRadius: 4,
    },
    cellOn: {
        backgroundColor: colors['accent-tint'],
        borderColor: colors['accent-border'],
    },
    cellOff: {
        backgroundColor: colors.surface,
        borderColor: colors.border,
    },
    label: {
        fontFamily: FontFamily.monoMedium,
        fontSize: 11,
        lineHeight: 11,
    },
    dot: {
        width: 4,
        height: 4,
        borderRadius: 2,
    },
    dotOn: {
        backgroundColor: colors.accent,
        boxShadow: `0 0 6px ${colors.accent}`,
    },
    dotOff: {
        backgroundColor: colors['ink-500'],
    },
});
