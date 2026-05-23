import { StyleSheet, Text, View } from 'react-native';

import { FontFamily } from '@/constants/fonts';
import config from '@/tailwind.config';

const colors = config.theme.extend.colors;

/**
 * 7-letter day label sequence anchored to Monday (`days[0]`). Matches the
 * Mon-first convention the API's `allowedDays` field uses.
 */
const DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const;

/**
 * Props for the full-width 7-day strip.
 */
export type DayStripProps = {
    /** Required. Booleans for Mon-Sun (index 0 = Mon). Length must be 7. */
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
            {DAY_LABELS.map((label, index) => {
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
    const names = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    return names[index] ?? 'Day';
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
