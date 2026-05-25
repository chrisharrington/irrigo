import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/button';
import { DayStrip } from '@/components/day-strip';
import { Refresh } from '@/components/icons';
import { TileGradient } from '@/components/tile-gradient';
import { FontFamily } from '@/constants/fonts';
import { daysArrayFromAllowed, formatDaysCsv, formatTimeWindow } from '@/lib/schedule-format';
import type { ScheduleListItem } from '@/api/types/schedules';
import config from '@/tailwind.config';

const colors = config.theme.extend.colors;

/**
 * Props for the active schedule hero card.
 */
export type ActiveScheduleHeroProps = {
    /** Required. The active schedule to display. */
    schedule: ScheduleListItem;

    /** Required. Whether tonight is currently skipped (drives the banner + footer label). */
    skipping: boolean;

    /** Optional. Re-plan button disabled state. Defaults to `false`. */
    isReplanning?: boolean;

    /** Required. Fires when the re-plan icon is pressed. */
    onReplan: () => void;

    /** Required. Fires when the "Switch profile" footer button is pressed. */
    onSwitchProfile: () => void;

    /** Required. Fires when the skip/resume footer button is pressed. */
    onToggleSkip: () => void;
};

/**
 * Hero card for the active irrigation profile on the Schedules screen.
 * Shows the running indicator, name + day/window summary, the week-at-a-
 * glance DayStrip, an optional skip-tonight banner, the next-run section,
 * a rules block, and the two footer action buttons (switch profile + skip
 * tonight). RN port of `ActiveScheduleHero` from `Mobile.jsx`.
 */
export function ActiveScheduleHero({
    schedule,
    skipping,
    isReplanning = false,
    onReplan,
    onSwitchProfile,
    onToggleSkip,
}: ActiveScheduleHeroProps) {
    const daysArray = useMemo(() => daysArrayFromAllowed(schedule.allowedDays), [schedule.allowedDays]);
    const daysCsv = useMemo(() => formatDaysCsv(schedule.allowedDays), [schedule.allowedDays]);
    const window = useMemo(() => formatTimeWindow(schedule.allowedTimeWindows), [schedule.allowedTimeWindows]);
    const summary = useMemo(() => `${daysCsv} · ${window}`, [daysCsv, window]);

    const rootOverride = schedule.rootDepthMOverride;
    const depletion = schedule.allowableDepletionFractionOverride;
    const endBySunrise = schedule.endBySunrise === true;

    return (
        <TileGradient style={styles.card}>
            <View style={styles.headerRow}>
                <View style={styles.runningPill}>
                    <View style={styles.runningDot} />
                    <Text style={styles.runningLabel}>Running</Text>
                </View>

                <Button
                    variant='ghost'
                    size='sm'
                    iconOnly
                    onPress={onReplan}
                    disabled={isReplanning}
                    accessibilityLabel='Re-plan now'
                >
                    <Refresh size={14} color={colors['fg-soft']} />
                </Button>
            </View>

            <View>
                <Text style={styles.name}>{schedule.name}</Text>
                <Text style={styles.summary}>{summary}</Text>
            </View>

            <DayStrip days={daysArray} />

            {skipping ? (
                <View accessibilityLabel='Tonight skipped' style={styles.skipBanner}>
                    <View style={styles.skipDot} />
                    <Text style={styles.skipText}>Tonight skipped</Text>
                </View>
            ) : null}

            <View style={styles.section}>
                <Text style={styles.eyebrow}>Next run</Text>
                {skipping ? (
                    <Text style={styles.skipBody}>Skipped tonight. Re-evaluating tomorrow morning.</Text>
                ) : (
                    <View>
                        <View style={styles.nextRunRow}>
                            <Text style={styles.nextRunBig}>{schedule.nextRun?.inLabel ?? '—'}</Text>
                            <Text style={styles.nextRunFromNow}>from now</Text>
                        </View>
                        <Text style={styles.nextRunSub}>
                            {schedule.nextRun
                                ? `${schedule.nextRun.whenLabel} · ${schedule.nextRun.zonesLabel}`
                                : 'No upcoming cycles.'}
                        </Text>
                    </View>
                )}
            </View>

            <View>
                <Text style={[styles.eyebrow, { marginBottom: 8 }]}>Rules</Text>
                <RuleRow label='Time window' value={window} />
                <RuleRow label='End by sunrise' value={endBySunrise ? 'On' : 'Off'} good={endBySunrise} />
                <RuleRow
                    label='Root depth override'
                    value={rootOverride !== null ? `${rootOverride.toFixed(2)} m` : '—'}
                    dim={rootOverride === null}
                />
                <RuleRow
                    label='Depletion fraction'
                    value={depletion !== null ? depletion.toFixed(2) : '—'}
                    dim={depletion === null}
                    last
                />
            </View>

            <View style={styles.actions}>
                <View style={styles.actionSlot}>
                    <Button variant='primary' onPress={onSwitchProfile}>Switch profile</Button>
                </View>
                <View style={styles.actionSlot}>
                    <Button variant='secondary' onPress={onToggleSkip}>
                        {skipping ? 'Resume tonight' : 'Skip tonight'}
                    </Button>
                </View>
            </View>
        </TileGradient>
    );
}

function RuleRow({
    label,
    value,
    good = false,
    dim = false,
    last = false,
}: {
    label: string;
    value: string;
    good?: boolean;
    dim?: boolean;
    last?: boolean;
}) {
    const valueColor = good ? colors.accent : dim ? colors['fg-dim'] : colors.fg;
    return (
        <View style={[styles.ruleRow, last ? null : styles.ruleRowDivider]} accessibilityLabel={`${label}: ${value}`}>
            <Text style={styles.ruleLabel}>{label}</Text>
            <Text style={[styles.ruleValue, { color: valueColor }]}>{value}</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    card: {
        borderWidth: 1,
        borderColor: colors['accent-border'],
        borderRadius: 4,
        padding: 18,
        gap: 16,
        boxShadow: `0 0 0 1px ${colors['accent-glow']} inset, 0 0 28px -4px ${colors['accent-glow']}`,
    },
    headerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    runningPill: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingVertical: 4,
        paddingHorizontal: 10,
        backgroundColor: colors['accent-tint'],
        borderWidth: 1,
        borderColor: colors['accent-border'],
        borderRadius: 4,
    },
    runningDot: {
        width: 7,
        height: 7,
        borderRadius: 4,
        backgroundColor: colors.accent,
        boxShadow: `0 0 10px ${colors.accent}`,
    },
    runningLabel: {
        fontFamily: FontFamily.sansMedium,
        fontSize: 11,
        lineHeight: 11,
        letterSpacing: 1.32,
        color: colors.accent,
        textTransform: 'uppercase',
    },
    name: {
        fontFamily: FontFamily.displayBold,
        fontSize: 30,
        lineHeight: 30,
        letterSpacing: -0.75,
        color: colors.fg,
    },
    summary: {
        marginTop: 6,
        fontFamily: FontFamily.sans,
        fontSize: 12,
        lineHeight: 16,
        color: colors['fg-muted'],
    },
    skipBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingVertical: 10,
        paddingHorizontal: 12,
        backgroundColor: colors['warn-tint'],
        borderWidth: 1,
        borderColor: colors['warn-border'],
        borderRadius: 4,
    },
    skipDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: colors.warn,
    },
    skipText: {
        flex: 1,
        fontFamily: FontFamily.sansMedium,
        fontSize: 13,
        lineHeight: 16,
        color: colors.fg,
    },
    section: {
        paddingTop: 10,
        borderTopWidth: 1,
        borderTopColor: colors.hairline,
    },
    eyebrow: {
        fontFamily: FontFamily.sansMedium,
        fontSize: 11,
        lineHeight: 13,
        letterSpacing: 1.54,
        color: colors['fg-muted'],
        textTransform: 'uppercase',
    },
    nextRunRow: {
        marginTop: 8,
        flexDirection: 'row',
        alignItems: 'baseline',
        gap: 8,
        flexWrap: 'wrap',
    },
    nextRunBig: {
        fontFamily: FontFamily.monoMedium,
        fontSize: 36,
        lineHeight: 36,
        letterSpacing: -1.08,
        color: colors.accent,
    },
    nextRunFromNow: {
        fontFamily: FontFamily.monoMedium,
        fontSize: 11,
        lineHeight: 13,
        color: colors['fg-muted'],
    },
    nextRunSub: {
        marginTop: 6,
        fontFamily: FontFamily.monoMedium,
        fontSize: 11,
        lineHeight: 13,
        color: colors['fg-dim'],
    },
    skipBody: {
        marginTop: 8,
        fontFamily: FontFamily.sans,
        fontSize: 12,
        lineHeight: 16,
        color: colors['fg-muted'],
    },
    ruleRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        gap: 16,
        paddingVertical: 10,
    },
    ruleRowDivider: {
        borderBottomWidth: 1,
        borderBottomColor: colors.hairline,
    },
    ruleLabel: {
        fontFamily: FontFamily.sans,
        fontSize: 12,
        lineHeight: 16,
        color: colors['fg-muted'],
    },
    ruleValue: {
        fontFamily: FontFamily.monoMedium,
        fontSize: 14,
        lineHeight: 16,
    },
    actions: {
        flexDirection: 'row',
        gap: 8,
    },
    actionSlot: {
        flex: 1,
    },
});
