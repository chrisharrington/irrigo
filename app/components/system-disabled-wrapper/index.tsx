import { View } from 'react-native';
import type { ReactNode } from 'react';

/**
 * Props for the system-disabled wrapper.
 */
export type SystemDisabledWrapperProps = {
    /** Required. Whether to dim and disable the wrapped children. */
    disabled: boolean;

    /** Required. The surfaces to dim/disable when `disabled` is true. */
    children: ReactNode;
};

/**
 * Wraps a slab of UI that should grey out and stop receiving touches when
 * the master irrigation kill switch is off. Drop the wrapper around any
 * Home / Schedule / drawer subtree that depends on the system being live;
 * the MasterToggle itself sits outside the wrapper so it remains
 * interactive. Mirrors the `irrigationOn ? auto : (opacity 0.32, no
 * pointer events)` treatment from the design source's `HomeView`.
 */
export function SystemDisabledWrapper({ disabled, children }: SystemDisabledWrapperProps) {
    return (
        <View
            style={disabled ? { opacity: 0.32, pointerEvents: 'none' } : undefined}
            accessibilityElementsHidden={disabled}
            importantForAccessibility={disabled ? 'no-hide-descendants' : 'auto'}
        >
            {children}
        </View>
    );
}
