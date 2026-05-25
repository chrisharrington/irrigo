import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const CANVAS_BG = '#000000';

export type StatusBarBackdropProps = {
    /** Optional. Hex/rgba color filling the status-bar inset. Defaults to the canvas base `#000000`. */
    color?: string;
};

/**
 * Paints an opaque rectangle behind the system status bar so its icons read
 * cleanly against busy screens. Needed because Android's `edgeToEdgeEnabled`
 * (set in app.json so the bottom-nav inset behaves) causes the app to draw
 * under the system bars, and `expo-status-bar`'s `backgroundColor` prop is
 * ignored when edge-to-edge is on (Expo SDK 54).
 *
 * Returns `null` when the top inset is zero (web / desktop) so no spurious
 * 0-height view is left in the tree.
 */
export function StatusBarBackdrop({ color = CANVAS_BG }: StatusBarBackdropProps = {}) {
    const insets = useSafeAreaInsets();
    if (insets.top === 0) return null;
    return (
        <View
            accessibilityLabel='Status bar backdrop'
            pointerEvents='none'
            style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                height: insets.top,
                backgroundColor: color,
            }}
        />
    );
}
