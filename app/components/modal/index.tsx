import {
    Modal as RNModal,
    Pressable,
    StyleSheet,
    View,
    type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import type { ReactNode } from 'react';

import config from '@/tailwind.config';

const colors = config.theme.extend.colors;
const shadows = config.theme.extend.boxShadow;

/**
 * Where the modal panel sits. `center` is the default dialog look; `bottom-sheet`
 * slides the panel up from the bottom (action-sheet style).
 */
export type ModalVariant = 'center' | 'bottom-sheet';

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

    /** Optional. Panel placement — `center` (default) for a centred dialog, `bottom-sheet` for a slide-up sheet. */
    variant?: ModalVariant;

    /** Required. Modal contents — typically header / body / footer composed by the caller. */
    children: ReactNode;
};

/**
 * Irrigo modal primitive — a dim+blur-backdropped overlay that either centres
 * a dialog (`variant='center'`) or slides a sheet up from the bottom
 * (`variant='bottom-sheet'`). Wraps React Native's built-in `Modal` so platform
 * overlay handling (Android back button, focus traps) Just Works. RN port of
 * `.modal` + `.scrim` from `components.css`.
 */
export function Modal({ visible, onRequestClose, accessibilityLabel, variant = 'center', children }: ModalProps) {
    const isSheet = variant === 'bottom-sheet';

    // Bottom safe-area inset pads the sheet panel so its content clears the
    // Android navigation bar once `navigationBarTranslucent` lets the modal
    // draw underneath it (APP-73). The centred variant ignores the inset.
    const insets = useSafeAreaInsets();

    return (
        <RNModal
            visible={visible}
            onRequestClose={onRequestClose}
            transparent
            animationType={isSheet ? 'slide' : 'fade'}
            statusBarTranslucent
            navigationBarTranslucent={isSheet}
        >
            <View style={isSheet ? styles.overlaySheet : styles.overlay}>
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
                    style={isSheet ? [styles.sheetContainer, { paddingBottom: insets.bottom }] : styles.container}
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

// Full-width panel anchored to the bottom of the screen. Top-only border
// radius (the bottom is flush to the screen edge) and no horizontal margin so
// it spans edge-to-edge like a native action sheet.
const sheetContainer: ViewStyle = {
    backgroundColor: colors['ink-300'],
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: colors.border,
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
    width: '100%',
    boxShadow: shadows['3'],
};

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    overlaySheet: {
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
    sheetContainer,
});
