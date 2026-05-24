import { useCallback, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { FontFamily } from '@/constants/fonts';
import { SUN_FIRST_DAY_LETTERS, daysArrayFromAllowed } from '@/lib/schedule-format';
import type { ScheduleListItem } from '@/api/types/schedules';
import config from '@/tailwind.config';

const colors = config.theme.extend.colors;

/**
 * Props for the active-schedule chip.
 */
export type ActiveScheduleChipProps = {
    /** Required. The currently active schedule. */
    schedule: ScheduleListItem;

    /** Required. Fires when the chip is pressed (caller routes to the Schedules screen). */
    onPress: () => void;

    /** Whether the active schedule is currently firing. When false/omitted, the RUNNING dot + label are hidden. */
    isRunning?: boolean;
};

/**
 * Pinned profile-card chip at the end of the Home feed. Surfaces the
 * active schedule's identity, running indicator, day mini-strip, and
 * next-run countdown. Tap routes to the Schedules screen.
 */
export function ActiveScheduleChip({ schedule, onPress, isRunning = false }: ActiveScheduleChipProps) {
    const days = useMemo(() => daysArrayFromAllowed(schedule.allowedDays), [schedule.allowedDays]);
    const countdown = schedule.nextRun?.inLabel ?? '—';
    const handlePress = useCallback(() => onPress(), [onPress]);

    return (
        <Pressable
            onPress={handlePress}
            accessibilityRole='button'
            accessibilityLabel={`Open Schedules — active profile ${schedule.name}`}
            style={styles.card}
        >
            <View style={styles.headerRow}>
                <Text style={styles.eyebrow}>On profile</Text>
                {isRunning && (
                    <View style={styles.runningSlot}>
                        <View style={styles.runningDot} />
                        <Text style={styles.runningLabel}>RUNNING</Text>
                    </View>
                )}
            </View>

            <View style={styles.bodyRow}>
                <View style={styles.bodyLeft}>
                    <Text style={styles.name}>{schedule.name}</Text>
                    <View style={styles.daysRow} accessibilityLabel='Schedule days'>
                        {SUN_FIRST_DAY_LETTERS.map((letter, index) => {
                            const on = days[index] === true;
                            return (
                                <Text
                                    // eslint-disable-next-line react/no-array-index-key
                                    key={index}
                                    style={[styles.dayLetter, on ? styles.dayLetterOn : styles.dayLetterOff]}
                                >
                                    {letter}
                                </Text>
                            );
                        })}
                    </View>
                </View>

                <View style={styles.bodyRight}>
                    <Text style={styles.countdownEyebrow}>Next run</Text>
                    <Text style={styles.countdown}>{countdown}</Text>
                </View>
            </View>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    card: {
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
        borderLeftWidth: 3,
        borderLeftColor: colors.accent,
        padding: 14,
        gap: 10,
    },
    headerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    eyebrow: {
        fontFamily: FontFamily.sansMedium,
        fontSize: 10,
        lineHeight: 10,
        letterSpacing: 1.6,
        color: colors['fg-muted'],
        textTransform: 'uppercase',
    },
    runningSlot: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    runningDot: {
        width: 6,
        height: 6,
        backgroundColor: colors.accent,
        boxShadow: `0 0 8px ${colors.accent}`,
    },
    runningLabel: {
        fontFamily: FontFamily.monoMedium,
        fontSize: 10,
        lineHeight: 10,
        letterSpacing: 0.8,
        color: colors.accent,
    },
    bodyRow: {
        flexDirection: 'row',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        gap: 16,
    },
    bodyLeft: {
        flex: 1,
        minWidth: 0,
    },
    name: {
        fontFamily: FontFamily.displaySemibold,
        fontSize: 22,
        lineHeight: 22,
        letterSpacing: -0.44,
        color: colors.fg,
    },
    daysRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        marginTop: 10,
    },
    dayLetter: {
        fontFamily: FontFamily.monoMedium,
        fontSize: 11,
        lineHeight: 11,
    },
    dayLetterOn: {
        color: colors.accent,
    },
    dayLetterOff: {
        color: colors['fg-dim'],
        opacity: 0.6,
    },
    bodyRight: {
        flexShrink: 0,
        alignItems: 'flex-end',
    },
    countdownEyebrow: {
        fontFamily: FontFamily.monoMedium,
        fontSize: 11,
        lineHeight: 13,
        color: colors['fg-dim'],
        marginBottom: 4,
    },
    countdown: {
        fontFamily: FontFamily.monoMedium,
        fontSize: 18,
        lineHeight: 18,
        letterSpacing: -0.36,
        color: colors.accent,
    },
});
