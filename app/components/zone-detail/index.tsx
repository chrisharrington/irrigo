import dayjs from 'dayjs';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { ActivityDto } from '@/api/types/activity';
import type { NextRunDto } from '@/api/types/next-run';
import type { ZoneSummary } from '@/api/types/zones';
import { Battery, computeBatteryGeometry } from '@/components/battery';
import { Button } from '@/components/button';
import { LawnPatch, type LawnPatchSlug } from '@/components/lawn-patch';
import { FontFamily } from '@/constants/fonts';
import config from '@/tailwind.config';

import { computeZoneStatusCopy } from './zone-status';

const colors = config.theme.extend.colors;

const TONE_COLOR = {
    ok: colors.accent,
    warn: colors.warn,
    danger: colors.danger,
} as const;

/**
 * Props for the Zone detail screen body.
 */
export type ZoneDetailProps = {
    /** Required. The zone whose detail is being rendered. */
    zone: ZoneSummary;

    /** Optional. Next-run summary used to append `· next run at HH:MM` to the tone copy. `undefined` while the query is loading or unavailable. */
    nextRun: NextRunDto | undefined;

    /** Required. Recent run rows for this zone, flattened from the activity query's pages. */
    activity: ReadonlyArray<ActivityDto>;

    /** Required. Whether the activity query is still in its first load. The component renders a hint when this is true and `activity` is empty. */
    isActivityLoading: boolean;

    /** Required. Fires when the user taps "Run now". Hidden when `zone.isRunning` is true (the Stop-watering button takes its place). */
    onRunNow: () => void;

    /** Required. Fires when the user taps "Stop watering" — only rendered when `zone.isRunning` is true. APP-69. */
    onStopWatering: () => void;

    /** Optional. Disables the Stop watering button while the close mutation is in flight. Defaults to `false`. APP-69. */
    isStopping?: boolean;

    /** Optional. Fires when the user taps "View all in Activity →" in the Recent runs section heading. When omitted, the link is hidden. APP-67. */
    onViewActivity?: () => void;
};

/**
 * Zone detail screen body: header (LawnPatch + name + tone copy), battery
 * hero, Run-now CTA, physical attributes table, and recent runs log. Pure
 * presentational — all data is supplied by the route, which composes
 * `useZone`, `useNextRun`, and `useActivity`.
 */
export function ZoneDetail({ zone, nextRun, activity, isActivityLoading, onRunNow, onStopWatering, isStopping = false, onViewActivity }: ZoneDetailProps) {
    const geometry = computeBatteryGeometry(zone.currentDepletionMm, zone.rawMm);
    const toneColor = TONE_COLOR[geometry.tone];
    const statusCopy = computeZoneStatusCopy(zone, nextRun);
    const scaleMaxMm = Math.round(geometry.scaleMax);

    return (
        <View style={styles.container}>
            <Text style={styles.eyebrow}>{zone.grassType.name} · {zone.areaM2} m²</Text>

            <View style={styles.headerRow}>
                <LawnPatch slug={normaliseSlug(zone.patch)} size={44} tone={toneColor} />
                <View style={styles.headerText}>
                    <Text style={styles.name}>{zone.name}</Text>
                    <Text style={[styles.statusCopy, geometry.tone === 'danger' ? { color: colors.danger } : null]}>
                        {statusCopy}
                    </Text>
                </View>
            </View>

            <View style={styles.heroCard}>
                <Text style={styles.heroEyebrow}>Soil-moisture deficit</Text>
                <View style={styles.heroFigureRow}>
                    <Text style={[styles.heroFigure, { color: toneColor }]}>{zone.currentDepletionMm.toFixed(1)}</Text>
                    <Text style={styles.heroUnit}>mm</Text>
                </View>
                <View style={styles.heroBattery}>
                    <Battery depletion={zone.currentDepletionMm} raw={zone.rawMm} tall />
                </View>
                <View style={styles.heroAxisRow}>
                    <Text style={styles.heroAxisTick}>0</Text>
                    <Text style={[styles.heroAxisTick, { color: colors.warn }]}>RAW · {zone.rawMm}</Text>
                    <Text style={styles.heroAxisTick}>{scaleMaxMm}</Text>
                </View>
            </View>

            {zone.isRunning ? (
                <Button variant='secondary' size='lg' onPress={onStopWatering} disabled={isStopping}>
                    Stop watering
                </Button>
            ) : (
                <Button variant='primary' size='lg' onPress={onRunNow}>Run now</Button>
            )}

            <View>
                <Text style={styles.sectionHeading}>Physical</Text>
                <View style={styles.attrTable}>
                    <AttrRow label='Grass type' value={zone.grassType.name} />
                    <AttrRow label='Area' value={`${zone.areaM2} m²`} />
                    <AttrRow label='Root depth' value={`${zone.rootDepthM.toFixed(2)} m`} />
                    <AttrRow label='Allowable depletion' value={zone.allowableDepletionFraction.toFixed(2)} />
                    <AttrRow label='Soil' value={zone.soilType.name} />
                    <AttrRow label='Precipitation rate' value={formatPrecipitation(zone.precipitationRateMmPerHr)} />
                    <AttrRow label='Microclimate factor' value={zone.microclimateFactor.toFixed(2)} />
                    <AttrRow label='Entity' value={zone.homeAssistantEntityId ?? '—'} mono />
                </View>
            </View>

            <View>
                <View style={styles.recentRunsHeading}>
                    <Text style={styles.sectionHeading}>Recent runs</Text>
                    {onViewActivity && (
                        <Pressable
                            onPress={onViewActivity}
                            accessibilityRole='link'
                            accessibilityLabel='View all in Activity'
                            hitSlop={8}
                        >
                            <Text style={styles.recentRunsLink}>View all in Activity →</Text>
                        </Pressable>
                    )}
                </View>
                {activity.length === 0 && isActivityLoading ? (
                    <Text style={styles.emptyState}>Loading recent runs…</Text>
                ) : activity.length === 0 ? (
                    <Text style={styles.emptyState}>No runs recorded yet.</Text>
                ) : (
                    <View style={styles.fireLog}>
                        {activity.map(row => (
                            <RecentRunRow key={row.id} row={row} />
                        ))}
                    </View>
                )}
            </View>
        </View>
    );
}

function AttrRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
    return (
        <View style={styles.attrRow}>
            <Text style={styles.attrLabel}>{label}</Text>
            <Text style={[styles.attrValue, mono ? styles.attrValueMono : null]}>{value}</Text>
        </View>
    );
}

function RecentRunRow({ row }: { row: ActivityDto }) {
    return (
        <View style={styles.fireRow}>
            <Text style={styles.fireDate}>{dayjs(row.date).format('MMM D')}</Text>
            <Text style={styles.fireApplied}>
                {row.appliedDepthMm.toFixed(1)} mm · {row.durationMin} min
            </Text>
            <Text style={styles.fireDelta}>
                {row.depletionBeforeMm.toFixed(1)} → {row.depletionAfterMm.toFixed(1)} mm
            </Text>
        </View>
    );
}

function normaliseSlug(patch: string): LawnPatchSlug {
    if (patch === 'a' || patch === 'b' || patch === 'c') return patch;
    return 'a';
}

function formatPrecipitation(value: number | null): string {
    if (value === null) return '—';
    return `${value.toFixed(1)} mm/hr`;
}

const styles = StyleSheet.create({
    container: {
        gap: 18,
        paddingHorizontal: 20,
        paddingTop: 12,
        paddingBottom: 32,
    },
    eyebrow: {
        fontFamily: FontFamily.sansMedium,
        fontSize: 10,
        lineHeight: 12,
        letterSpacing: 1.4,
        textTransform: 'uppercase',
        color: colors['fg-muted'],
    },
    headerRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 14,
    },
    headerText: {
        flex: 1,
        minWidth: 0,
    },
    name: {
        fontFamily: FontFamily.displaySemibold,
        fontSize: 32,
        lineHeight: 34,
        letterSpacing: -0.8,
        color: colors.fg,
    },
    statusCopy: {
        marginTop: 4,
        fontFamily: FontFamily.sans,
        fontSize: 13,
        lineHeight: 17,
        color: colors['fg-muted'],
    },
    heroCard: {
        backgroundColor: colors['ink-300'],
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 4,
        padding: 18,
        gap: 8,
    },
    heroEyebrow: {
        fontFamily: FontFamily.sansMedium,
        fontSize: 10,
        lineHeight: 12,
        letterSpacing: 1.4,
        textTransform: 'uppercase',
        color: colors['fg-muted'],
    },
    heroFigureRow: {
        flexDirection: 'row',
        alignItems: 'baseline',
        gap: 6,
        marginTop: 6,
    },
    heroFigure: {
        fontFamily: FontFamily.monoMedium,
        fontSize: 56,
        lineHeight: 56,
        letterSpacing: -2,
    },
    heroUnit: {
        fontFamily: FontFamily.monoMedium,
        fontSize: 20,
        lineHeight: 24,
        color: colors['fg-muted'],
    },
    heroBattery: {
        marginTop: 14,
    },
    heroAxisRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginTop: 4,
    },
    heroAxisTick: {
        fontFamily: FontFamily.monoMedium,
        fontSize: 11,
        lineHeight: 13,
        color: colors['fg-dim'],
    },
    sectionHeading: {
        marginBottom: 10,
        fontFamily: FontFamily.displaySemibold,
        fontSize: 16,
        lineHeight: 20,
        color: colors.fg,
    },
    recentRunsHeading: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'baseline',
    },
    recentRunsLink: {
        marginBottom: 10,
        fontFamily: FontFamily.sansMedium,
        fontSize: 12,
        lineHeight: 14,
        color: colors['fg-muted'],
    },
    attrTable: {
        borderTopWidth: 1,
        borderTopColor: colors.hairline,
    },
    attrRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 10,
        borderBottomWidth: 1,
        borderBottomColor: colors.hairline,
        gap: 12,
    },
    attrLabel: {
        fontFamily: FontFamily.sans,
        fontSize: 13,
        lineHeight: 17,
        color: colors['fg-muted'],
    },
    attrValue: {
        flexShrink: 1,
        fontFamily: FontFamily.sansMedium,
        fontSize: 13,
        lineHeight: 17,
        color: colors.fg,
        textAlign: 'right',
    },
    attrValueMono: {
        fontFamily: FontFamily.monoMedium,
        fontSize: 12,
    },
    fireLog: {
        borderTopWidth: 1,
        borderTopColor: colors.hairline,
    },
    fireRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 10,
        borderBottomWidth: 1,
        borderBottomColor: colors.hairline,
        gap: 8,
    },
    fireDate: {
        fontFamily: FontFamily.sansMedium,
        fontSize: 13,
        lineHeight: 17,
        color: colors.fg,
        width: 64,
    },
    fireApplied: {
        flex: 1,
        fontFamily: FontFamily.monoMedium,
        fontSize: 12,
        lineHeight: 14,
        color: colors['fg-muted'],
    },
    fireDelta: {
        fontFamily: FontFamily.monoMedium,
        fontSize: 12,
        lineHeight: 14,
        color: colors['fg-dim'],
    },
    emptyState: {
        fontFamily: FontFamily.sans,
        fontSize: 13,
        lineHeight: 17,
        color: colors['fg-muted'],
    },
});
