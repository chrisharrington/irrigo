import { useEffect, useRef } from 'react';
import { Animated, Pressable, View } from 'react-native';
import { tv, type VariantProps } from 'tailwind-variants';

import { Duration } from '@/constants/motion';
import config from '@/tailwind.config';

const colors = config.theme.extend.colors;

const TRACK_OFF_COLOR = colors['ink-400'];
const TRACK_ON_COLOR = colors.accent;
const THUMB_OFF_COLOR = colors['chalk-200'];
const THUMB_ON_COLOR = colors['on-accent'];

const SIZE_SPEC = {
    default: { width: 44, height: 26, padding: 3 },
    lg: { width: 54, height: 30, padding: 3 },
} as const;

const toggle = tv({
    slots: {
        track: 'rounded-r-1 border',
        thumb: 'absolute rounded-r-1',
    },
    variants: {
        on: {
            true: { track: 'border-transparent' },
            false: { track: 'border-border' },
        },
        disabled: {
            true: { track: 'opacity-40' },
            false: {},
        },
    },
    defaultVariants: { on: false, disabled: false },
});

type ToggleVariants = VariantProps<typeof toggle>;

/**
 * Props for the Irrigo toggle primitive.
 */
export type ToggleProps = {
    /** Required. Controlled on/off state. */
    value: boolean;

    /** Required. Fires with the negated value when the toggle is pressed (and not disabled). */
    onValueChange: (next: boolean) => void;

    /** Optional. Hit-target size. `default` 44×26; `lg` 54×30 (used by the master irrigation switch). Defaults to `default`. */
    size?: keyof typeof SIZE_SPEC;

    /** Optional. Disables interaction and dims the control. Defaults to `false`. */
    disabled?: ToggleVariants['disabled'];

    /** Optional. Accessibility label spoken by screen readers. */
    accessibilityLabel?: string;
};

/**
 * The Irrigo toggle primitive — animated track + thumb mirroring the
 * `.toggle` recipe from the design CSS. Used by the master irrigation
 * switch (size `lg`) and any future inline boolean controls (size
 * `default`). The thumb position and the track color tween together over
 * 220ms whenever `value` flips.
 */
export function Toggle({
    value,
    onValueChange,
    size = 'default',
    disabled = false,
    accessibilityLabel,
}: ToggleProps) {
    const spec = SIZE_SPEC[size];
    const thumbSize = spec.height - spec.padding * 2 - 2;
    const thumbTravel = spec.width - spec.height;

    const animated = useRef(new Animated.Value(value ? 1 : 0)).current;
    useEffect(() => {
        Animated.timing(animated, {
            toValue: value ? 1 : 0,
            duration: Duration.default,
            useNativeDriver: false,
        }).start();
    }, [animated, value]);

    const trackBackgroundColor = animated.interpolate({
        inputRange: [0, 1],
        outputRange: [TRACK_OFF_COLOR, TRACK_ON_COLOR],
    });
    const thumbBackgroundColor = animated.interpolate({
        inputRange: [0, 1],
        outputRange: [THUMB_OFF_COLOR, THUMB_ON_COLOR],
    });
    const thumbTranslateX = animated.interpolate({
        inputRange: [0, 1],
        outputRange: [0, thumbTravel],
    });

    const styles = toggle({ on: value, disabled });

    return (
        <Pressable
            onPress={disabled ? undefined : () => onValueChange(!value)}
            disabled={disabled}
            accessibilityRole='switch'
            accessibilityLabel={accessibilityLabel}
            accessibilityState={{ checked: value, disabled }}
        >
            <View style={{ width: spec.width, height: spec.height }}>
                <Animated.View
                    className={styles.track()}
                    style={{
                        position: 'absolute',
                        left: 0,
                        right: 0,
                        top: 0,
                        bottom: 0,
                        backgroundColor: trackBackgroundColor,
                    }}
                />
                <Animated.View
                    className={styles.thumb()}
                    style={{
                        top: spec.padding,
                        left: spec.padding,
                        width: thumbSize,
                        height: thumbSize,
                        backgroundColor: thumbBackgroundColor,
                        transform: [{ translateX: thumbTranslateX }],
                    }}
                />
            </View>
        </Pressable>
    );
}
