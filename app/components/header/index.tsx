import { StyleSheet, Text, View } from 'react-native';

import { BrandGlyph } from '@/components/brand-glyph';
import { Button } from '@/components/button';
import { Bell, Menu } from '@/components/icons';
import { FontFamily } from '@/constants/fonts';
import { useAlerts } from '@/hooks/alerts';
import { useSystem } from '@/hooks/system';
import { SEVERITY_COLOR, highestSeverity } from '@/lib/alert-severity';
import config from '@/tailwind.config';
import { useMemo } from 'react';

const colors = config.theme.extend.colors;

/**
 * Props for the Irrigo app header.
 */
export type HeaderProps = {
    /**
     * Required. Fired when the hamburger button is tapped (and irrigation is
     * on). The header itself is drawer-agnostic — the root layout wires this
     * prop to the nav drawer's open handler.
     */
    onMenuPress: () => void;

    /**
     * Required. Fired when the bell button is tapped (and irrigation is on).
     * The destination screen is owned by the caller — the full alerts view
     * is a follow-up ticket (APP-62 wires the bell, not the route).
     */
    onAlertsPress: () => void;
};

/**
 * The shared app header — hamburger on the left, `BrandGlyph` + `Irrigo`
 * wordmark in the centre, alert bell on the right. RN port of the App
 * header block in [`Alerts.jsx`](app/design/ui_kit/Alerts.jsx) (APP-62 —
 * the bell replaces the earlier refresh icon; re-plan stays accessible
 * from the active-schedule hero card).
 *
 * Reads the master irrigation switch via `useSystem`. When the system is off
 * (or the query hasn't resolved yet — sticky-off during cold start), both
 * icon buttons disable and the centre brand row dims to 0.45 opacity. The
 * design source uses `filter: grayscale(1)` to desaturate the brand, but
 * React Native has no CSS filter; opacity is the portable approximation.
 *
 * The bell pulls the unacked alert count from `useAlerts()`. Badge hides
 * when the count is zero, displays the integer up to 9, and caps at `9+`.
 * Badge colour follows the highest-severity unacked tone — danger first,
 * then warn, then accent.
 */
export function Header({ onMenuPress, onAlertsPress }: HeaderProps) {
    const { data: system } = useSystem();
    const { data: alertsData } = useAlerts();
    const irrigationOn = system?.irrigationEnabled === true;

    const alerts = alertsData ?? [];
    const count = alerts.length;
    const display = count > 9 ? '9+' : String(count);
    const severity = useMemo(() => highestSeverity(alerts), [alerts]);
    const alertsLabel = count === 0 ? 'Alerts, no unread' : `Alerts, ${count} unread`;

    return (
        <View className='flex-row items-center justify-between gap-3 px-4 pt-1 pb-[14px]'>
            <Button
                iconOnly
                variant='ghost'
                accessibilityLabel='Open menu'
                disabled={!irrigationOn}
                onPress={onMenuPress}
            >
                <Menu size={18} />
            </Button>
            <View className='flex-row items-center gap-2' style={{ opacity: irrigationOn ? 1 : 0.45 }}>
                <BrandGlyph size={24} />
                <Text
                    style={{
                        fontFamily: FontFamily.displaySemibold,
                        fontSize: 16,
                        lineHeight: 16,
                        letterSpacing: -0.32,
                        color: colors.fg,
                    }}
                >
                    Irrigo
                </Text>
            </View>
            <Button
                iconOnly
                variant='ghost'
                accessibilityLabel={alertsLabel}
                disabled={!irrigationOn}
                onPress={onAlertsPress}
            >
                <View style={styles.bellSlot}>
                    <Bell size={18} />
                    {count > 0 && (
                        <View
                            accessibilityLabel={`Unread count ${display}`}
                            style={[styles.badge, { backgroundColor: SEVERITY_COLOR[severity] }]}
                        >
                            <Text style={styles.badgeText}>{display}</Text>
                        </View>
                    )}
                </View>
            </Button>
        </View>
    );
}

const styles = StyleSheet.create({
    bellSlot: {
        position: 'relative',
        alignItems: 'center',
        justifyContent: 'center',
    },
    badge: {
        position: 'absolute',
        top: -6,
        right: -8,
        minWidth: 14,
        height: 14,
        paddingHorizontal: 3,
        borderRadius: 7,
        alignItems: 'center',
        justifyContent: 'center',
        // Punch-out ring matching the design source: a 2px ring of the
        // surface colour separates the badge from the icon behind it.
        boxShadow: `0 0 0 2px ${colors.bg}`,
    },
    badgeText: {
        fontFamily: FontFamily.monoSemibold,
        fontSize: 9,
        lineHeight: 12,
        color: colors['on-accent'],
    },
});
