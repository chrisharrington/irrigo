import { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
    Animated,
    Modal as RNModal,
    Pressable,
    StyleSheet,
    Text,
    View,
    type ViewStyle,
} from 'react-native';
import { BlurView } from 'expo-blur';

import { BrandGlyph } from '@/components/brand-glyph';
import { Button } from '@/components/button';
import { Cal, History, Home as HomeIcon, X, Zone, type IconProps } from '@/components/icons';
import { FontFamily } from '@/constants/fonts';
import { Duration, MotionEasing } from '@/constants/motion';
import { useSchedules } from '@/hooks/schedules';
import config from '@/tailwind.config';
import type { ScheduleAllowedTimeWindow, ScheduleListItem } from '@/api/types/schedules';

const colors = config.theme.extend.colors;
const shadows = config.theme.extend.boxShadow;

const DRAWER_WIDTH = 280;

/**
 * The four nav destinations the drawer offers. Consumers map these to their
 * own routes; the drawer itself stays route-agnostic.
 */
export type NavItemId = 'home' | 'zones' | 'schedules' | 'activity';

type NavItem = {
    id: NavItemId;
    label: string;
    icon: (props: IconProps) => React.JSX.Element;
};

const NAV_ITEMS: readonly NavItem[] = [
    { id: 'home', label: 'Home', icon: HomeIcon },
    { id: 'zones', label: 'Zones', icon: Zone },
    { id: 'schedules', label: 'Schedules', icon: Cal },
    { id: 'activity', label: 'Activity', icon: History },
];

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

/**
 * Renders a schedule's `allowedDays` + `allowedTimeWindows` into the
 * `Wed · Fri · Sun · 00:00–10:00` form the drawer footer card displays.
 *
 * - `days === null` → "Every day" (no day restriction).
 * - `windows` null / empty → "any time" (no window restriction).
 * - Multiple windows → comma-joined (`08:00–10:00, 18:00–20:00`).
 */
function formatCadence(days: number[] | null, windows: ScheduleAllowedTimeWindow[] | null): string {
    const dayLabel = days === null
        ? 'Every day'
        : days.map(d => DAY_LABELS[d - 1] ?? '?').join(' · ');
    const windowLabel = !windows || windows.length === 0
        ? 'any time'
        : windows.map(w => `${w.start}–${w.end}`).join(', ');
    return `${dayLabel} · ${windowLabel}`;
}

/**
 * Props for the Irrigo side drawer.
 */
export type NavDrawerProps = {
    /** Required. Whether the drawer is open. Controls slide-in/out + mount. */
    visible: boolean;

    /** Required. Called when the user requests dismissal (scrim tap, close button, Android back, or after selecting a nav item). */
    onClose: () => void;

    /** Required. The id of the currently-active nav destination. The matching row paints with the active treatment + dot indicator. */
    activeId: NavItemId;

    /** Required. Called with the tapped item's id when the user picks a nav destination or hits "Switch profile" (which passes `'schedules'`). */
    onSelect: (id: NavItemId) => void;
};

/**
 * Irrigo's left-anchored nav drawer. Composes a brand row, four nav items
 * (Home / Zones / Schedules / Activity), and a glow-bordered footer card
 * surfacing the currently-active schedule with a "Switch profile" shortcut.
 *
 * Controlled component — `visible`, `activeId`, `onClose`, and `onSelect`
 * are all owned by the parent shell. Selecting a nav item fires
 * `onSelect(id)` followed by `onClose()` so the drawer dismisses after a
 * navigation, matching the Mobile.jsx tap-then-close UX.
 *
 * Slide animation: 280ms `translateX` from `-DRAWER_WIDTH → 0` (open) and
 * back (close). RN Modal handles the platform overlay + Android back; the
 * internal `modalVisible` state lags the `visible` prop so the slide-OUT
 * runs to completion before the Modal unmounts. `useSchedules` powers the
 * footer card; when no schedule is active (or the query is still in flight)
 * the footer renders a `—` placeholder rather than a blank card.
 */
export function NavDrawer({ visible, onClose, activeId, onSelect }: NavDrawerProps) {
    const translateX = useRef(new Animated.Value(-DRAWER_WIDTH)).current;
    const [modalVisible, setModalVisible] = useState(visible);

    useEffect(() => {
        if (visible) {
            setModalVisible(true);
            // Defer the slide one frame so the Modal tree mount on frame N
            // doesn't compete with the animation start. APP-68 / APP-64.
            const handle = requestAnimationFrame(() => {
                Animated.timing(translateX, {
                    toValue: 0,
                    duration: Duration.default,
                    easing: MotionEasing.standard,
                    useNativeDriver: true,
                }).start();
            });
            return () => cancelAnimationFrame(handle);
        }
        if (modalVisible) {
            // Close path stays synchronous — no mount cost to compete with.
            Animated.timing(translateX, {
                toValue: -DRAWER_WIDTH,
                duration: Duration.default,
                easing: MotionEasing.standard,
                useNativeDriver: true,
            }).start(({ finished }) => {
                if (finished) setModalVisible(false);
            });
        }
        return undefined;
    }, [visible, modalVisible, translateX]);

    const handleSelect = useCallback((id: NavItemId) => {
        onSelect(id);
        onClose();
    }, [onSelect, onClose]);
    const handleSwitchProfile = useCallback(() => handleSelect('schedules'), [handleSelect]);

    const { data: schedules } = useSchedules();
    const activeSchedule = schedules?.find(row => row.isActive) ?? null;

    return (
        <RNModal
            visible={modalVisible}
            onRequestClose={onClose}
            transparent
            animationType='none'
            statusBarTranslucent
        >
            <View style={styles.overlay}>
                <Pressable
                    style={StyleSheet.absoluteFill}
                    onPress={onClose}
                    accessibilityRole='button'
                    accessibilityLabel='Dismiss drawer'
                >
                    <BlurView intensity={50} tint='dark' style={StyleSheet.absoluteFill} />
                    <View style={styles.scrim} />
                </Pressable>

                <Animated.View
                    style={[styles.panel, { transform: [{ translateX }] }]}
                    accessibilityViewIsModal
                    accessibilityLabel='Navigation'
                >
                    <View style={styles.brandRow}>
                        <View style={styles.brandIdentity}>
                            <BrandGlyph size={28} />
                            <View>
                                <Text style={styles.wordmark}>Irrigo</Text>
                                <Text style={styles.subtitle}>Calgary · 740 m²</Text>
                            </View>
                        </View>
                        <Button
                            iconOnly
                            size='sm'
                            variant='ghost'
                            accessibilityLabel='Close menu'
                            onPress={onClose}
                        >
                            <X size={14} />
                        </Button>
                    </View>

                    <View style={styles.nav}>
                        {NAV_ITEMS.map(item => (
                            <NavRow
                                key={item.id}
                                item={item}
                                active={item.id === activeId}
                                onPress={() => handleSelect(item.id)}
                            />
                        ))}
                    </View>

                    <View style={styles.footerSlot}>
                        <ActiveScheduleCard
                            schedule={activeSchedule}
                            onSwitchProfile={handleSwitchProfile}
                        />
                    </View>
                </Animated.View>
            </View>
        </RNModal>
    );
}

function NavRow({ item, active, onPress }: { item: NavItem; active: boolean; onPress: () => void }) {
    const rowStyle: ViewStyle = {
        ...styles.navRow,
        backgroundColor: active ? colors['surface-2'] : 'transparent',
        borderColor: active ? colors.border : 'transparent',
    };
    return (
        <Pressable
            onPress={onPress}
            accessibilityRole='button'
            accessibilityLabel={item.label}
            accessibilityState={{ selected: active }}
            style={rowStyle}
        >
            <item.icon size={18} color={active ? colors.accent : colors['fg-muted']} />
            <Text style={[styles.navLabel, { color: active ? colors.fg : colors['fg-soft'] }]}>
                {item.label}
            </Text>
            {active && <View style={styles.activeDot} />}
        </Pressable>
    );
}

/**
 * Memoized footer card so that `useSchedules()` resolving mid-slide-in only
 * re-renders this subtree, not the whole drawer (BrandGlyph, NavRows, and
 * the Animated.View panel skip the reconcile). Requires a reference-stable
 * `onSwitchProfile` — the parent wraps it in `useCallback`. APP-68 / APP-64.
 */
const ActiveScheduleCard = memo(function ActiveScheduleCard({
    schedule,
    onSwitchProfile,
}: {
    schedule: ScheduleListItem | null;
    onSwitchProfile: () => void;
}) {
    const name = schedule?.name ?? '—';
    const cadence = schedule
        ? formatCadence(schedule.allowedDays, schedule.allowedTimeWindows)
        : '';
    return (
        <View style={styles.activeCard}>
            <Text style={styles.activeEyebrow}>ACTIVE</Text>
            <Text style={styles.activeName}>{name}</Text>
            {cadence !== '' && <Text style={styles.activeCadence}>{cadence}</Text>}
            <View style={styles.switchButtonRow}>
                <Button variant='secondary' size='sm' onPress={onSwitchProfile}>
                    Switch profile
                </Button>
            </View>
        </View>
    );
});

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
    },
    scrim: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'rgba(2, 4, 3, 0.55)',
    },
    panel: {
        position: 'absolute',
        top: 0,
        bottom: 0,
        left: 0,
        width: DRAWER_WIDTH,
        backgroundColor: colors['ink-300'],
        borderRightWidth: 1,
        borderRightColor: colors.border,
        boxShadow: shadows['3'],
        paddingTop: 60,
        flexDirection: 'column',
    },
    brandRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingTop: 6,
        paddingBottom: 18,
    },
    brandIdentity: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    wordmark: {
        fontFamily: FontFamily.displaySemibold,
        fontSize: 18,
        lineHeight: 18,
        letterSpacing: -0.36,
        color: colors.fg,
    },
    subtitle: {
        marginTop: 2,
        fontFamily: FontFamily.sans,
        fontSize: 12,
        lineHeight: 14,
        color: colors['fg-muted'],
    },
    nav: {
        paddingHorizontal: 12,
        paddingTop: 8,
        flexDirection: 'column',
        gap: 2,
    },
    navRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        paddingHorizontal: 14,
        paddingVertical: 12,
        borderRadius: 4,
        borderWidth: 1,
    },
    navLabel: {
        flex: 1,
        fontFamily: FontFamily.sansMedium,
        fontSize: 15,
        lineHeight: 15,
    },
    activeDot: {
        width: 6,
        height: 6,
        borderRadius: 4,
        backgroundColor: colors.accent,
        boxShadow: `0 0 8px ${colors.accent}`,
    },
    footerSlot: {
        marginTop: 'auto',
        padding: 16,
    },
    activeCard: {
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors['accent-border'],
        borderRadius: 8,
        paddingHorizontal: 14,
        paddingTop: 14,
        paddingBottom: 12,
    },
    activeEyebrow: {
        fontFamily: FontFamily.sansSemibold,
        fontSize: 11,
        lineHeight: 11,
        letterSpacing: 1.54,
        color: colors.accent,
    },
    activeName: {
        marginTop: 4,
        fontFamily: FontFamily.displaySemibold,
        fontSize: 18,
        lineHeight: 22,
        color: colors.fg,
    },
    activeCadence: {
        marginTop: 2,
        fontFamily: FontFamily.sans,
        fontSize: 12,
        lineHeight: 16,
        color: colors['fg-muted'],
    },
    switchButtonRow: {
        marginTop: 12,
    },
});
