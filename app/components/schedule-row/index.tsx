import { Pressable, StyleSheet, Text, View } from 'react-native';

import { DayDots } from '@/components/day-dots';
import { ChevR } from '@/components/icons';
import { FontFamily } from '@/constants/fonts';
import { daysArrayFromAllowed, formatDaysCsv, formatTimeWindow } from '@/lib/schedule-format';
import type { ScheduleListItem } from '@/api/types/schedules';
import config from '@/tailwind.config';

const colors = config.theme.extend.colors;

/**
 * Props for the non-active schedule row.
 */
export type ScheduleRowProps = {
    /** Required. The schedule to display. */
    schedule: ScheduleListItem;

    /** Required. Fires with the schedule when the row is pressed. */
    onSwitch: (schedule: ScheduleListItem) => void;
};

/**
 * One non-active schedule row on the Schedules screen — name + days/window
 * summary on the left, DayDots preview + "Switch" chevron on the right.
 * Tap → caller opens the confirmation modal. RN port of the row body in
 * `ScheduleView` from `Mobile.jsx`.
 */
export function ScheduleRow({ schedule, onSwitch }: ScheduleRowProps) {
    const daysArray = daysArrayFromAllowed(schedule.allowedDays);
    const summary = `${formatDaysCsv(schedule.allowedDays)} · ${formatTimeWindow(schedule.allowedTimeWindows)}`;

    return (
        <Pressable
            onPress={() => onSwitch(schedule)}
            accessibilityRole='button'
            accessibilityLabel={`Switch to ${schedule.name}`}
            style={styles.row}
        >
            <View style={styles.body}>
                <Text style={styles.name}>{schedule.name}</Text>
                <Text style={styles.summary}>{summary}</Text>
            </View>

            <View style={styles.right}>
                <DayDots days={daysArray} />
                <View style={styles.switchSlot}>
                    <Text style={styles.switchLabel}>Switch</Text>
                    <ChevR size={12} color={colors['fg-soft']} />
                </View>
            </View>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        paddingVertical: 14,
        paddingHorizontal: 14,
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 4,
    },
    body: {
        flexShrink: 1,
        minWidth: 0,
    },
    name: {
        fontFamily: FontFamily.displaySemibold,
        fontSize: 15,
        lineHeight: 17,
        color: colors.fg,
    },
    summary: {
        marginTop: 4,
        fontFamily: FontFamily.monoMedium,
        fontSize: 11,
        lineHeight: 13,
        color: colors['fg-muted'],
    },
    right: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    switchSlot: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },
    switchLabel: {
        fontFamily: FontFamily.sansMedium,
        fontSize: 12,
        lineHeight: 12,
        color: colors['fg-soft'],
    },
});
