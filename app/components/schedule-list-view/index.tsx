import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ActiveScheduleHero } from '@/components/active-schedule-hero';
import { Button } from '@/components/button';
import { ScheduleRow } from '@/components/schedule-row';
import { SwitchScheduleModal } from '@/components/switch-schedule-modal';
import { FontFamily } from '@/constants/fonts';
import {
    useEnableSchedule,
    useResumeScheduleTonight,
    useSchedules,
    useSkipScheduleTonight,
} from '@/hooks/schedules';
import { useReplan } from '@/hooks/replan';
import type { ScheduleListItem } from '@/api/types/schedules';
import config from '@/tailwind.config';

const colors = config.theme.extend.colors;

/**
 * Smart container for the Schedules screen. Calls the schedules / replan
 * hooks, partitions the result into active + others, and composes the
 * hero, switch rows, and the switch-confirmation modal. Drop-in for any
 * screen route — caller wraps it in their own scroll container.
 */
export function ScheduleListView() {
    const schedules = useSchedules();
    const enableSchedule = useEnableSchedule();
    const skipTonight = useSkipScheduleTonight();
    const resumeTonight = useResumeScheduleTonight();
    const replan = useReplan();
    const [pendingSwitch, setPendingSwitch] = useState<ScheduleListItem | null>(null);

    if (schedules.isPending) {
        return (
            <View style={styles.container}>
                <Text style={styles.eyebrow}>Profile · loading</Text>
                <Text style={styles.title}>Schedules</Text>
                <Text style={styles.placeholder}>Fetching schedules…</Text>
            </View>
        );
    }

    if (schedules.isError || schedules.data === undefined) {
        return (
            <View style={styles.container}>
                <Text style={styles.eyebrow}>Profile · unavailable</Text>
                <Text style={styles.title}>Schedules</Text>
                <Text style={styles.errorText}>Failed to load schedules.</Text>
            </View>
        );
    }

    const active = schedules.data.find(item => item.isActive) ?? schedules.data[0];
    const others = active === undefined
        ? []
        : schedules.data.filter(item => item.id !== active.id);
    const skipping = active?.skippedTonight === true;

    const handleConfirmSwitch = (): void => {
        if (pendingSwitch === null) return;
        const targetSlug = pendingSwitch.slug;
        enableSchedule.mutate(targetSlug, {
            onSuccess: () => setPendingSwitch(null),
        });
    };

    const handleToggleSkip = (): void => {
        if (skipping) resumeTonight.mutate();
        else skipTonight.mutate();
    };

    return (
        <View style={styles.container}>
            <Text style={styles.eyebrow}>Profile · {active ? '1 active' : 'none active'}</Text>
            <Text style={styles.title}>Schedules</Text>

            {active && (
                <ActiveScheduleHero
                    schedule={active}
                    skipping={skipping}
                    isReplanning={replan.isPending}
                    onReplan={() => replan.mutate()}
                    onSwitchProfile={() => setPendingSwitch(active)}
                    onToggleSkip={handleToggleSkip}
                />
            )}

            <View style={styles.otherHeading}>
                <Text style={styles.h2}>Other profiles</Text>
                <Button variant='ghost' size='sm' disabled accessibilityLabel='Add new profile'>
                    + New
                </Button>
            </View>

            <View style={styles.otherList}>
                {others.map(schedule => (
                    <ScheduleRow
                        key={schedule.id}
                        schedule={schedule}
                        onSwitch={setPendingSwitch}
                    />
                ))}
            </View>

            <SwitchScheduleModal
                schedule={pendingSwitch}
                onCancel={() => setPendingSwitch(null)}
                onConfirm={handleConfirmSwitch}
                isSubmitting={enableSchedule.isPending}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        gap: 18,
        paddingHorizontal: 20,
    },
    eyebrow: {
        fontFamily: FontFamily.sansMedium,
        fontSize: 11,
        lineHeight: 13,
        letterSpacing: 1.54,
        color: colors['fg-muted'],
        textTransform: 'uppercase',
    },
    title: {
        fontFamily: FontFamily.displayBold,
        fontSize: 28,
        lineHeight: 28,
        letterSpacing: -0.7,
        color: colors.fg,
    },
    placeholder: {
        fontFamily: FontFamily.sans,
        fontSize: 14,
        lineHeight: 20,
        color: colors['fg-muted'],
    },
    errorText: {
        fontFamily: FontFamily.sans,
        fontSize: 14,
        lineHeight: 20,
        color: colors.warn,
    },
    otherHeading: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginTop: 6,
    },
    h2: {
        fontFamily: FontFamily.displaySemibold,
        fontSize: 18,
        lineHeight: 22,
        letterSpacing: -0.09,
        color: colors.fg,
    },
    otherList: {
        gap: 8,
    },
});
