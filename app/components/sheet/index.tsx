import {
    Modal as RNModal,
    Pressable,
    StyleSheet,
    View,
    type ViewStyle,
} from 'react-native';
import { BlurView } from 'expo-blur';
import type { ReactNode } from 'react';

import config from '@/tailwind.config';

const colors = config.theme.extend.colors;
const shadows = config.theme.extend.boxShadow;

/**
 * Props for the Irrigo bottom-sheet primitive.
 */
export type SheetProps = {
    /** Required. Whether the sheet is visible. */
    visible: boolean;
    /** Required. Called when the user taps the backdrop or triggers the platform-native dismiss (Android back). */
    onRequestClose: () => void;
    /** Optional. Accessibility label for the sheet container, announced when it opens. */
    accessibilityLabel?: string;
    /** Required. Sheet contents — rows / actions composed by the caller. */
    children: ReactNode;
};

/**
 * Irrigo bottom-sheet primitive — a bottom-anchored container with a grabber
 * affordance and a dim+blur backdrop. Wraps React Native's built-in `Modal`
 * for platform overlay handling. RN port of `.sheet` + `.scrim` from
 * `components.css`.
 */
export function Sheet({ visible, onRequestClose, accessibilityLabel, children }: SheetProps) {
    return (
        <RNModal
            visible={visible}
            onRequestClose={onRequestClose}
            transparent
            animationType='slide'
            statusBarTranslucent
        >
            <View style={styles.overlay}>
                <Pressable
                    style={StyleSheet.absoluteFill}
                    onPress={onRequestClose}
                    accessibilityRole='button'
                    accessibilityLabel='Dismiss sheet'
                >
                    <BlurView intensity={50} tint='dark' style={StyleSheet.absoluteFill} />
                    <View style={styles.scrim} />
                </Pressable>

                <View
                    style={styles.container}
                    accessibilityViewIsModal
                    accessibilityLabel={accessibilityLabel}
                >
                    <View style={styles.grabber} />
                    {children}
                </View>
            </View>
        </RNModal>
    );
}

const container: ViewStyle = {
    backgroundColor: colors['ink-300'],
    borderTopWidth: 1,
    borderTopColor: colors.border,
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
    paddingTop: 18,
    paddingHorizontal: 18,
    paddingBottom: 22,
    boxShadow: shadows['3'],
};

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        justifyContent: 'flex-end',
    },
    scrim: {
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        backgroundColor: colors.scrim,
    },
    container,
    grabber: {
        width: 40,
        height: 4,
        backgroundColor: colors['ink-600'],
        borderRadius: 4,
        alignSelf: 'center',
        marginBottom: 14,
    },
});
