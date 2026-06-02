import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
    Animated,
    Dimensions,
    Modal as RNModal,
    Pressable,
    StyleSheet,
    View,
    type LayoutChangeEvent,
    type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';

import { Duration, MotionEasing } from '@/constants/motion';
import config from '@/tailwind.config';

const colors = config.theme.extend.colors;
const shadows = config.theme.extend.boxShadow;

// Slide distance used for the very first open, before the panel has been
// measured. Any value taller than the panel keeps it fully off-screen.
const FALLBACK_SHEET_HEIGHT = Dimensions.get('window').height;

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
export function Modal(props: ModalProps) {
    return props.variant === 'bottom-sheet' ? <BottomSheet {...props} /> : <CenteredModal {...props} />;
}

/**
 * Centred dialog variant — RN `Modal`'s built-in cross-fade is all the motion
 * it needs since the panel doesn't move.
 */
function CenteredModal({ visible, onRequestClose, accessibilityLabel, children }: ModalProps) {
    return (
        <RNModal
            visible={visible}
            onRequestClose={onRequestClose}
            transparent
            animationType='fade'
            statusBarTranslucent
            navigationBarTranslucent={false}
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

/**
 * Bottom-sheet variant. RN `Modal`'s own `animationType` would slide the whole
 * window — backdrop included — so we drive the motion ourselves: a single
 * `progress` value (0 closed → 1 open) fades the backdrop uniformly across the
 * screen while sliding the panel up from below, and reverses both on close. The
 * window stays mounted through the closing animation via `mounted` so the
 * fade-out / slide-down can play before unmount.
 */
function BottomSheet({ visible, onRequestClose, accessibilityLabel, children }: ModalProps) {
    // Bottom safe-area inset pads the panel so its content clears the Android
    // navigation bar once `navigationBarTranslucent` lets the sheet draw under it.
    const insets = useSafeAreaInsets();

    const [mounted, setMounted] = useState<boolean>(visible);
    const [sheetHeight, setSheetHeight] = useState<number>(0);

    const progress = useRef(new Animated.Value(visible ? 1 : 0)).current;

    useEffect(() => {
        if (visible) {
            setMounted(true);
            // Start the slide once the panel has been measured so it travels its
            // real height; the layout pass below re-runs this effect with a height.
            if (sheetHeight > 0) runTiming(progress, 1);
        } else if (mounted) {
            runTiming(progress, 0, () => setMounted(false));
        }
    }, [visible, sheetHeight, mounted, progress]);

    const handleLayout = (event: LayoutChangeEvent): void => {
        const measured = event.nativeEvent.layout.height;
        setSheetHeight(prev => (prev === measured ? prev : measured));
    };

    if (!mounted) return null;

    const translateY = progress.interpolate({
        inputRange: [0, 1],
        outputRange: [sheetHeight > 0 ? sheetHeight : FALLBACK_SHEET_HEIGHT, 0],
    });

    return (
        <RNModal
            visible
            onRequestClose={onRequestClose}
            transparent
            animationType='none'
            statusBarTranslucent
            navigationBarTranslucent
        >
            <View style={styles.overlaySheet}>
                <Animated.View style={[StyleSheet.absoluteFill, { opacity: progress }]}>
                    <Pressable
                        style={StyleSheet.absoluteFill}
                        onPress={onRequestClose}
                        accessibilityRole='button'
                        accessibilityLabel='Dismiss modal'
                    >
                        <BlurView intensity={50} tint='dark' style={StyleSheet.absoluteFill} />
                        <View style={styles.scrim} />
                    </Pressable>
                </Animated.View>

                <Animated.View
                    style={[styles.sheetContainer, { paddingBottom: insets.bottom, transform: [{ translateY }] }]}
                    onLayout={handleLayout}
                    accessibilityViewIsModal
                    accessibilityLabel={accessibilityLabel}
                >
                    {children}
                </Animated.View>
            </View>
        </RNModal>
    );
}

// Animates `value` to `toValue` on the brand-canonical ease-out, invoking
// `onDone` only when the animation runs to completion (not when interrupted).
function runTiming(value: Animated.Value, toValue: number, onDone?: () => void): void {
    Animated.timing(value, {
        toValue,
        duration: Duration.default,
        easing: MotionEasing.standard,
        useNativeDriver: true,
    }).start(onDone ? ({ finished }) => { if (finished) onDone(); } : undefined);
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

// Full-width sheet anchored flush to the bottom edge: square corners, no side
// borders (it spans edge-to-edge), a hairline top border, and an upward-casting
// shadow that lifts the sheet off the content behind it.
const sheetContainer: ViewStyle = {
    backgroundColor: colors['ink-300'],
    borderTopWidth: 1,
    borderColor: colors.border,
    width: '100%',
    boxShadow: '0 -8px 24px rgba(0, 0, 0, 0.5)',
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
