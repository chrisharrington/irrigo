import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { AlertDto } from '@/api/types/alerts';
import { Button } from '@/components/button';
import { RefreshableScrollView } from '@/components/refreshable-scroll-view';
import { FontFamily } from '@/constants/fonts';
import { useAckAlert, useAlerts } from '@/hooks/alerts';
import config from '@/tailwind.config';
import { AlertCard } from './alert-card';
import { bucketFor, type AlertBucket } from './bucketing';
import { EmptyState } from './empty-state';

const colors = config.theme.extend.colors;

type Filter = 'all' | 'unread' | 'critical';

// Recency groups in display order, with the headers from the mock.
const GROUPS: ReadonlyArray<{ id: AlertBucket; label: string }> = [
    { id: 'new', label: 'New' },
    { id: 'today', label: 'Earlier today' },
    { id: 'week', label: 'This week' },
    { id: 'older', label: 'Older' },
];

/**
 * Props for the Alerts smart container.
 */
export type AlertsViewProps = {
    /**
     * Optional. Reference time used to bucket and timestamp each alert
     * against the device clock. Defaults to the current wall clock; tests
     * inject a fixed value so assertions are stable.
     */
    now?: Date;
};

/**
 * The Alerts screen — the header bell's destination. Reads `useAlerts()`,
 * filters by All / Unread / Critical, and groups the result by recency
 * (New / Earlier today / This week / Older) into `AlertCard` rows. "Mark all
 * read" fans out `useAckAlert()` over every unread alert in parallel. Shows
 * `EmptyState` when there are no alerts at all, and a "no match" line when a
 * filter empties the list. RN port of `AlertsView` from
 * [`Alerts.jsx`](app/design/ui_kit/Alerts.jsx). APP-79.
 */
export function AlertsView({ now = new Date() }: AlertsViewProps = {}) {
    const insets = useSafeAreaInsets();
    const { data } = useAlerts();
    const ackAlert = useAckAlert();
    const [filter, setFilter] = useState<Filter>('all');

    const alerts = useMemo(() => data ?? [], [data]);
    const isEmpty = alerts.length === 0;

    // Per-filter counts shown on the chips.
    const counts = useMemo(
        () => ({
            all: alerts.length,
            unread: alerts.filter(a => !a.ack).length,
            critical: alerts.filter(a => a.tone === 'danger').length,
        }),
        [alerts],
    );

    // The list after the active filter, then split into recency groups.
    const visible = useMemo(() => applyFilter(alerts, filter), [alerts, filter]);
    const groups = useMemo(
        () =>
            GROUPS.map(g => ({ ...g, rows: visible.filter(a => bucketFor(a.when, now) === g.id) })).filter(
                g => g.rows.length > 0,
            ),
        [visible, now],
    );

    const onMarkAllRead = useCallback(() => {
        const unread = alerts.filter(a => !a.ack);
        console.log(`alerts: marking ${unread.length} alert(s) read.`);
        Promise.all(unread.map(a => ackAlert.mutateAsync(a.id))).catch(err => {
            console.warn('alerts: mark-all-read failed for one or more alerts.', err);
        });
    }, [alerts, ackAlert]);

    const markAllDisabled = counts.unread === 0;

    return (
        <View style={styles.screen}>
            {/* Page heading + filter chips. The header row (back / title) was
                removed per APP-82; the screen leans on the global app chrome
                and OS/gesture back. "Mark all read" lives alongside the
                heading title now. */}
            <View style={styles.headingBlock}>
                <Text style={styles.eyebrow}>
                    {isEmpty ? 'All clear' : `${counts.unread} unread · ${counts.all} total`}
                </Text>
                <View style={styles.titleRow}>
                    <Text style={styles.title}>{isEmpty ? 'Nothing to flag' : 'Recent alerts'}</Text>
                    {!isEmpty && (
                        <Button
                            variant='secondary'
                            size='sm'
                            disabled={markAllDisabled}
                            onPress={onMarkAllRead}
                            accessibilityLabel='Mark all read'
                        >
                            Mark all read
                        </Button>
                    )}
                </View>

                {!isEmpty && (
                    <View style={styles.chips}>
                        <FilterChip
                            label='All'
                            count={counts.all}
                            active={filter === 'all'}
                            onPress={() => setFilter('all')}
                        />
                        <FilterChip
                            label='Unread'
                            count={counts.unread}
                            active={filter === 'unread'}
                            onPress={() => setFilter('unread')}
                        />
                        <FilterChip
                            label='Critical'
                            count={counts.critical}
                            active={filter === 'critical'}
                            onPress={() => setFilter('critical')}
                        />
                    </View>
                )}
            </View>

            {/* Body — grouped list, no-match line, or empty state. */}
            <RefreshableScrollView
                style={styles.body}
                contentContainerStyle={[styles.bodyContent, { paddingBottom: insets.bottom + 24 }]}
            >
                {isEmpty ?
                    <EmptyState />
                : groups.length === 0 ?
                    <Text style={styles.noMatch}>No alerts match this filter.</Text>
                :   groups.map((g, gi) => (
                        <View key={g.id} style={gi === 0 ? null : styles.groupGap}>
                            <View style={styles.groupHeader}>
                                <Text style={styles.groupLabel}>{g.label}</Text>
                                <Text style={styles.groupCount}>{g.rows.length}</Text>
                            </View>
                            <View style={styles.groupRows}>
                                {g.rows.map(a => (
                                    <AlertCard key={a.id} alert={a} now={now} />
                                ))}
                            </View>
                        </View>
                    ))
                }
            </RefreshableScrollView>
        </View>
    );
}

/** Applies the active filter to the alert list. */
function applyFilter(alerts: readonly AlertDto[], filter: Filter): AlertDto[] {
    if (filter === 'unread') return alerts.filter(a => !a.ack);
    if (filter === 'critical') return alerts.filter(a => a.tone === 'danger');
    return [...alerts];
}

/** A single filter chip with its count. */
function FilterChip({
    label,
    count,
    active,
    onPress,
}: {
    label: string;
    count: number;
    active: boolean;
    onPress: () => void;
}) {
    return (
        <Pressable
            accessibilityRole='button'
            accessibilityLabel={label}
            accessibilityState={{ selected: active }}
            onPress={onPress}
            style={[styles.chip, active ? styles.chipActive : null]}
        >
            <Text style={[styles.chipLabel, active ? styles.chipLabelActive : null]}>{label}</Text>
            <Text style={[styles.chipCount, active ? styles.chipCountActive : null]}>{count}</Text>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    screen: {
        flex: 1,
        backgroundColor: colors.bg,
    },
    headingBlock: {
        gap: 14,
        paddingHorizontal: 20,
        paddingTop: 6,
        paddingBottom: 14,
    },
    eyebrow: {
        fontFamily: FontFamily.sansMedium,
        fontSize: 11,
        lineHeight: 13,
        letterSpacing: 1.54,
        textTransform: 'uppercase',
        color: colors['fg-muted'],
    },
    titleRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 12,
        marginTop: 8,
    },
    title: {
        fontFamily: FontFamily.displayBold,
        fontSize: 28,
        lineHeight: 28,
        letterSpacing: -0.7,
        color: colors.fg,
    },
    chips: {
        flexDirection: 'row',
        gap: 6,
    },
    chip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingVertical: 7,
        paddingHorizontal: 11,
        borderWidth: 1,
        borderColor: colors.hairline,
        borderRadius: 4,
        backgroundColor: 'transparent',
    },
    chipActive: {
        borderColor: colors.border,
        backgroundColor: colors['surface-2'],
    },
    chipLabel: {
        fontFamily: FontFamily.sansMedium,
        fontSize: 12,
        lineHeight: 12,
        color: colors['fg-muted'],
    },
    chipLabelActive: {
        color: colors.fg,
    },
    chipCount: {
        fontFamily: FontFamily.monoMedium,
        fontSize: 11,
        lineHeight: 11,
        color: colors['fg-dim'],
    },
    chipCountActive: {
        color: colors['fg-soft'],
    },
    body: {
        flex: 1,
    },
    bodyContent: {
        paddingHorizontal: 20,
    },
    noMatch: {
        fontFamily: FontFamily.sansMedium,
        fontSize: 14,
        lineHeight: 20,
        color: colors['fg-muted'],
        textAlign: 'center',
        paddingVertical: 40,
    },
    groupGap: {
        marginTop: 22,
    },
    groupHeader: {
        flexDirection: 'row',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        marginBottom: 8,
    },
    groupLabel: {
        fontFamily: FontFamily.sansMedium,
        fontSize: 10,
        lineHeight: 10,
        letterSpacing: 1.6,
        textTransform: 'uppercase',
        color: colors['fg-muted'],
    },
    groupCount: {
        fontFamily: FontFamily.monoMedium,
        fontSize: 11,
        lineHeight: 11,
        color: colors['fg-dim'],
    },
    groupRows: {
        gap: 8,
    },
});
