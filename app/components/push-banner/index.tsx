import { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AlertRow, type AlertRowTone } from '@/components/alert-row';

const AUTO_DISMISS_MS = 6000;

/**
 * Props for the foreground push banner.
 */
export type PushBannerProps = {
    /** Required. Whether the banner is visible. When `false`, nothing renders. */
    visible: boolean;

    /** Required. Visual tone — passes through to the underlying AlertRow. */
    tone: AlertRowTone;

    /** Required. Banner title. */
    title: string;

    /** Optional. Banner sub-line. */
    sub?: string;

    /** Optional. Fired when the user taps the banner (route to the related zone or activity). */
    onPress?: () => void;

    /** Required. Fired when the user manually dismisses or after the auto-dismiss timer. */
    onDismiss: () => void;
};

/**
 * Top-aligned banner used by the `NotificationsBridge` to surface
 * incoming foreground push notifications. Wraps `AlertRow` for the visual
 * treatment and adds a 6-second auto-dismiss timer plus tap-to-route.
 * Hidden when `visible` is `false`.
 */
export function PushBanner({ visible, tone, title, sub, onPress, onDismiss }: PushBannerProps) {
    const insets = useSafeAreaInsets();

    useEffect(() => {
        if (!visible) return;
        const handle = setTimeout(() => {
            onDismiss();
        }, AUTO_DISMISS_MS);
        return () => clearTimeout(handle);
    }, [visible, onDismiss]);

    if (!visible) return null;

    return (
        <View style={[styles.wrap, { top: insets.top + 8 }]} pointerEvents='box-none'>
            <Pressable
                onPress={onPress}
                accessibilityRole='button'
                accessibilityLabel={`Notification: ${title}`}
                style={styles.tap}
            >
                <AlertRow tone={tone} title={title} {...(sub !== undefined ? { sub } : {})} />
            </Pressable>
        </View>
    );
}

const styles = StyleSheet.create({
    wrap: {
        position: 'absolute',
        left: 16,
        right: 16,
        zIndex: 100,
    },
    tap: {
        width: '100%',
    },
});
