import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActiveScheduleChip } from '@/components/active-schedule-chip';
import { MasterToggle } from '@/components/master-toggle';
import { NextRunHero } from '@/components/next-run-hero';
import { SystemDisabledWrapper } from '@/components/system-disabled-wrapper';
import { ZoneTile } from '@/components/zone-tile';
import { FontFamily } from '@/constants/fonts';
import { useNextRun } from '@/hooks/next-run';
import { useSchedules } from '@/hooks/schedules';
import { useSystem } from '@/hooks/system';
import { useZones } from '@/hooks/zones';
import type { ZoneSummary } from '@/api/types/zones';
import config from '@/tailwind.config';

const colors = config.theme.extend.colors;

/**
 * Smart container for the Home screen. Composes the master kill switch
 * with the next-run hero, the zone tiles, and the active-schedule chip
 * (each backed by its own React Query hook). When the master toggle is
 * off, the body wraps in `SystemDisabledWrapper` so every surface below
 * the switch dims to 0.32 opacity and stops receiving touches.
 */
export function HomeView() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const system = useSystem();
    const nextRun = useNextRun();
    const zones = useZones();
    const schedules = useSchedules();

    const irrigationEnabled = system.data?.irrigationEnabled ?? true;
    const activeSchedule = schedules.data?.find(item => item.isActive) ?? null;

    const handleZonePress = (zone: ZoneSummary): void => {
        router.push(`/zone/${zone.slug}` as never);
    };

    const handleSchedulePress = (): void => {
        router.push('/schedules' as never);
    };

    return (
        <ScrollView
            style={styles.scroll}
            contentContainerStyle={[styles.content, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 32 }]}
        >
            <MasterToggle />

            <SystemDisabledWrapper disabled={!irrigationEnabled}>
                <View style={styles.body}>
                    {nextRun.isPending ? (
                        <PlaceholderCard label='Loading next run…' />
                    ) : nextRun.isError || nextRun.data == null ? (
                        <PlaceholderCard label='Failed to load next run.' tone='error' />
                    ) : (
                        // siteTimezone comes from the API response — single
                        // source of truth, no env-var dependency (APP-54).
                        <NextRunHero nextRun={nextRun.data} siteTimezone={nextRun.data.timezone} />
                    )}

                    <View style={styles.zonesHeading}>
                        <Text style={styles.h2}>Zones</Text>
                        {zones.data !== undefined && zones.data.length > 0 ? (
                            <Text style={styles.zonesMeta}>
                                {zones.data.length} · {totalArea(zones.data)} m²
                            </Text>
                        ) : null}
                    </View>

                    {zones.isPending ? (
                        <PlaceholderCard label='Loading zones…' />
                    ) : zones.isError || zones.data == null ? (
                        <PlaceholderCard label='Failed to load zones.' tone='error' />
                    ) : (
                        <View style={styles.zoneList}>
                            {zones.data.map(zone => (
                                <ZoneTile key={zone.id} zone={zone} onPress={handleZonePress} />
                            ))}
                        </View>
                    )}

                    {activeSchedule !== null && (
                        <ActiveScheduleChip
                            schedule={activeSchedule}
                            onPress={handleSchedulePress}
                            isRunning={nextRun.data?.state === 'firing'}
                        />
                    )}
                </View>
            </SystemDisabledWrapper>
        </ScrollView>
    );
}

function totalArea(zones: ReadonlyArray<ZoneSummary>): number {
    return zones.reduce((sum, zone) => sum + zone.areaM2, 0);
}

function PlaceholderCard({ label, tone = 'muted' }: { label: string; tone?: 'muted' | 'error' }) {
    return (
        <View style={[styles.placeholder, tone === 'error' ? styles.placeholderError : null]}>
            <Text
                style={[
                    styles.placeholderText,
                    tone === 'error' ? { color: colors.warn } : { color: colors['fg-muted'] },
                ]}
            >
                {label}
            </Text>
        </View>
    );
}

const styles = StyleSheet.create({
    scroll: {
        flex: 1,
    },
    content: {
        gap: 18,
        paddingHorizontal: 20,
    },
    body: {
        gap: 18,
    },
    zonesHeading: {
        flexDirection: 'row',
        alignItems: 'baseline',
        justifyContent: 'space-between',
    },
    h2: {
        fontFamily: FontFamily.displaySemibold,
        fontSize: 18,
        lineHeight: 22,
        letterSpacing: -0.09,
        color: colors.fg,
    },
    zonesMeta: {
        fontFamily: FontFamily.monoMedium,
        fontSize: 11,
        lineHeight: 13,
        color: colors['fg-dim'],
    },
    zoneList: {
        gap: 10,
    },
    placeholder: {
        padding: 14,
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 4,
    },
    placeholderError: {
        borderColor: colors['warn-border'],
        backgroundColor: colors['warn-tint'],
    },
    placeholderText: {
        fontFamily: FontFamily.sans,
        fontSize: 12,
        lineHeight: 17,
    },
});
