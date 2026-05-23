import {
    Modal as RNModal,
    Pressable,
    StyleSheet,
    View,
    type ViewStyle,
} from 'react-native';
import { BlurView } from 'expo-blur';
import type { ReactNode } from 'react';

import config from '../../tailwind.config';

const colors = config.theme.extend.colors;
const shadows = config.theme.extend.boxShadow;

/**
 * Props for the Irrigo modal primitive.
 */
export type ModalProps = {
    /** Required. Whether the modal is visible. */
    visible: boolean;
    /** Required. Called when the user taps the backdrop or triggers the platform-native dismiss (Android back). */
    onRequestClose: () => void;
    /** Optional. Accessibility label for the modal container, announced when it opens. */
    accessibilityLabel?: string;
    /** Required. Modal contents — typically header / body / footer composed by the caller. */
    children: ReactNode;
};

/**
 * Irrigo modal primitive — a centred dialog with a dim+blur backdrop. Wraps
 * React Native's built-in `Modal` so platform overlay handling (Android back
 * button, focus traps) Just Works. RN port of `.modal` + `.scrim` from
 * `components.css`.
 */
export function Modal({ visible, onRequestClose, accessibilityLabel, children }: ModalProps) {
    return (
        <RNModal
            visible={visible}
            onRequestClose={onRequestClose}
            transparent
            animationType='fade'
            statusBarTranslucent
        >
            <View style={styles.overlay}>
                <Pressable
                    style={StyleSheet.absoluteFill}
                    onPress={onRequestClose}
                    accessibilityRole='button'
                    accessibilityLabel='Dismiss modal'
                >
                    <BlurView intensity={50} tint='dark' style={StyleSheet.absoluteFill} />
                    <View style={styles.scrim} />
                </Pressable>

                <View
                    style={styles.container}
                    accessibilityViewIsModal
                    accessibilityLabel={accessibilityLabel}
                >
                    {children}
                </View>
            </View>
        </RNModal>
    );
}

const container: ViewStyle = {
    backgroundColor: colors['ink-300'],
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 4,
    width: '100%',
    maxWidth: 440,
    marginHorizontal: 16,
    boxShadow: shadows['3'],
};

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    scrim: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: colors.scrim,
    },
    container,
});
