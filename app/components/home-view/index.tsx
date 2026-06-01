import { useEffect, useRef } from 'react';
import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { ZoneSummary } from '@/api/types/zones';
import { ActiveScheduleChip } from '@/components/active-schedule-chip';
import { DepletionLegend } from '@/components/depletion-legend';
import { MasterToggle } from '@/components/master-toggle';
import { NextRunHero } from '@/components/next-run-hero';
import { RefreshableScrollView } from '@/components/refreshable-scroll-view';
import { SystemDisabledWrapper } from '@/components/system-disabled-wrapper';
import { ZoneTile } from '@/components/zone-tile';
import { FontFamily } from '@/constants/fonts';
import { useNextRun } from '@/hooks/next-run';
import { useSchedules } from '@/hooks/schedules';
import { useSystem } from '@/hooks/system';
import { useZones } from '@/hooks/zones';
import config from '@/tailwind.config';

const colors = config.theme.extend.colors;

// Safety-net backstop: drop the splash unconditionally after this long,
// even if a query is still pending. Anything beyond this and something is
// genuinely wrong (API totally hung) — the user is better off seeing the
// home screen's own error placeholders than a frozen splash. APP-51.
const SPLASH_BACKSTOP_MS = 30_000;

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

    useHideSplashOnReady({ system, nextRun, zones, schedules });

    const irrigationEnabled = system.data?.irrigationEnabled ?? true;
    const activeSchedule = schedules.data?.find(item => item.isActive) ?? null;

    const handleZonePress = (zone: ZoneSummary): void => {
        router.push(`/zone/${zone.slug}` as never);
    };

    const handleSchedulePress = (): void => {
        router.push('/schedules' as never);
    };

    return (
        <RefreshableScrollView
            style={styles.scroll}
            contentContainerStyle={[styles.content, { paddingTop: 16, paddingBottom: insets.bottom + 32 }]}
        >
            <MasterToggle />

            <SystemDisabledWrapper disabled={!irrigationEnabled}>
                <View style={styles.body}>
                    {nextRun.isPending ?
                        <PlaceholderCard label='Loading next run…' />
                    : nextRun.isError || nextRun.data == null ?
                        <PlaceholderCard label='Failed to load next run.' tone='error' />
                        // Times render in the device-local timezone (APP-88) —
                        // no timezone is threaded from the API.
                    :   <NextRunHero nextRun={nextRun.data} />}

                    <View style={styles.zonesHeading}>
                        <Text style={styles.h2}>Zones</Text>
                        {zones.data !== undefined && zones.data.length > 0 ?
                            <Text style={styles.zonesMeta}>
                                {zones.data.length} · {totalArea(zones.data)} m²
                            </Text>
                        :   null}
                    </View>

                    {zones.isPending ?
                        <PlaceholderCard label='Loading zones…' />
                    : zones.isError || zones.data == null ?
                        <PlaceholderCard label='Failed to load zones.' tone='error' />
                    :   <>
                            <DepletionLegend />
                            <View style={styles.zoneList}>
                                {zones.data.map(zone => (
                                    <ZoneTile key={zone.id} zone={zone} onPress={handleZonePress} />
                                ))}
                            </View>
                        </>
                    }

                    {activeSchedule !== null && (
                        <ActiveScheduleChip
                            schedule={activeSchedule}
                            onPress={handleSchedulePress}
                            isRunning={nextRun.data?.state === 'firing'}
                        />
                    )}
                </View>
            </SystemDisabledWrapper>
        </RefreshableScrollView>
    );
}

/**
 * Drops the native splash screen once the four home-screen queries have
 * settled (each one either has data or has finished its retry chain with
 * an error). A 30-second backstop fires `hideAsync` unconditionally if
 * something hangs, so a broken API can't leave the user staring at the
 * splash forever. APP-51.
 */
function useHideSplashOnReady(queries: {
    system: { isPending: boolean };
    nextRun: { isPending: boolean };
    zones: { isPending: boolean };
    schedules: { isPending: boolean };
}): void {
    const hidden = useRef<boolean>(false);

    const { system, nextRun, zones, schedules } = queries;
    const allSettled = !system.isPending && !nextRun.isPending && !zones.isPending && !schedules.isPending;

    useEffect(() => {
        if (hidden.current || !allSettled) return;
        hidden.current = true;
        console.log('splash: home data settled; dropping splash.');
        // Defer to the next frame so React's commit lands and the screen
        // paints with real data BEFORE the native splash starts its hide
        // animation. Without this, the user can briefly see unrendered
        // chrome between the splash drop and the data-bound HomeView paint.
        requestAnimationFrame(() => {
            SplashScreen.hideAsync().catch(err => {
                console.warn('splash: SplashScreen.hideAsync failed; swallowing.', err);
            });
        });
    }, [allSettled]);

    useEffect(() => {
        const id = setTimeout(() => {
            if (hidden.current) return;
            hidden.current = true;
            console.warn('splash: backstop timer fired before home data settled; dropping anyway.', {
                queries: {
                    system: !system.isPending,
                    nextRun: !nextRun.isPending,
                    zones: !zones.isPending,
                    schedules: !schedules.isPending,
                },
            });
            SplashScreen.hideAsync().catch(err => {
                console.warn('splash: SplashScreen.hideAsync failed; swallowing.', err);
            });
        }, SPLASH_BACKSTOP_MS);
        return () => clearTimeout(id);
        // The backstop is started once on mount; the in-effect read of the
        // `isPending` flags is for the diagnostic payload only.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
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
