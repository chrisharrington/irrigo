import type { ReactNode } from 'react';
import { Pressable, Text } from 'react-native';
import Animated, {
    Easing,
    interpolateColor,
    useAnimatedStyle,
    useSharedValue,
    withTiming,
} from 'react-native-reanimated';
import { tv, type VariantProps } from 'tailwind-variants';

import config from '@/tailwind.config';

const colors = config.theme.extend.colors;

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

const PRESS_DURATION_MS = 100;
const PRESS_EASING = Easing.out(Easing.ease);

type PressColors = {
    bg: string;
    bgPressed: string;
    border?: string;
    borderPressed?: string;
};

const VARIANT_COLORS: Record<'primary' | 'secondary' | 'ghost', PressColors> = {
    primary: {
        bg: colors.accent,
        bgPressed: colors['accent-press'],
    },
    secondary: {
        bg: colors.surface,
        bgPressed: colors['surface-2'],
        border: colors.border,
        borderPressed: colors['border-strong'],
    },
    ghost: {
        bg: 'transparent',
        bgPressed: colors.surface,
    },
};

const button = tv({
    slots: {
        // Layout & Structure
        base: 'flex-row items-center justify-center gap-2 rounded-r-2 border border-transparent active:translate-y-[0.5px]',
        // Typography
        label: 'font-medium font-body leading-none tracking-[-0.005em]',
    },
    variants: {
        variant: {
            primary: {
                base: 'shadow-glow-accent',
                label: 'text-on-accent',
            },
            secondary: {
                base: 'border-border',
                label: 'text-fg',
            },
            ghost: {
                base: '',
                label: 'text-fg-soft',
            },
        },
        size: {
            sm: {
                base: 'h-[32px] px-3',
                label: 'text-[12px]',
            },
            default: {
                base: 'h-[44px] px-[18px]',
                label: 'text-[14px]',
            },
            lg: {
                base: 'h-[56px] px-6',
                label: 'text-[15px]',
            },
        },
        iconOnly: {
            true: { base: 'px-0' },
            false: {},
        },
        disabled: {
            true: { base: 'opacity-40' },
            false: {},
        },
    },
    compoundVariants: [
        { iconOnly: true, size: 'sm', class: { base: 'w-[32px]' } },
        { iconOnly: true, size: 'default', class: { base: 'w-[44px]' } },
        { iconOnly: true, size: 'lg', class: { base: 'w-[56px]' } },
    ],
    defaultVariants: {
        variant: 'primary',
        size: 'default',
        iconOnly: false,
        disabled: false,
    },
});

type ButtonVariants = VariantProps<typeof button>;

/**
 * Props interface for the Button primitive.
 */
export type ButtonProps = {
    /** Optional. Color variant. Defaults to `primary`. */
    variant?: ButtonVariants['variant'];

    /** Optional. Pixel size of the hit target. `sm` 32px, `default` 44px, `lg` 56px. Defaults to `default`. */
    size?: ButtonVariants['size'];

    /** Optional. Renders a square icon-only button (no horizontal padding). Children should be a single icon element rather than a text label. Defaults to `false`. */
    iconOnly?: boolean;

    /** Optional. Disables the button — skips `onPress`, applies opacity 0.4, and exposes the disabled state to assistive tech. Defaults to `false`. */
    disabled?: boolean;

    /** Optional. Press handler. */
    onPress?: () => void;

    /** Optional. Accessibility label. Required when `iconOnly` is true since there is no text label for screen readers. */
    accessibilityLabel?: string;

    /** Optional. Button contents. A plain string for labeled buttons, or an icon element when `iconOnly` is true. */
    children?: ReactNode;
};

/**
 * The Irrigo button primitive. Mirrors the four CSS button recipes from
 * `app/design/irrigo/project/components.css`: primary (accent fill, lighter
 * `accent-press` on press), secondary (surface fill, border, lifts to
 * surface-2 on press), and ghost (transparent, fills to surface on press).
 * Background (and the secondary's border) animate with a ~100 ms ease-out
 * fade driven by Reanimated; transform and typography are static. The inner
 * Text declares `pointerEvents='none'` so taps on the label reach the
 * `Pressable` parent (a real-device issue jest's `fireEvent.press` masked).
 *
 * Web hover styling is intentionally not wired here — the design source's
 * "hover lifts surface" rule is web-only and reliably testing it across
 * RN + react-native-web is out of scope for this primitive.
 */
export function Button({
    variant = 'primary',
    size = 'default',
    iconOnly = false,
    disabled = false,
    onPress,
    accessibilityLabel,
    children,
}: ButtonProps) {
    const styles = button({ variant, size, iconOnly, disabled });
    const variantColors = VARIANT_COLORS[variant ?? 'primary'];
    const pressed = useSharedValue<number>(0);

    const animatedStyle = useAnimatedStyle(() => {
        const style: { backgroundColor: string; borderColor?: string } = {
            backgroundColor: interpolateColor(
                pressed.value,
                [0, 1],
                [variantColors.bg, variantColors.bgPressed],
            ),
        };
        if (variantColors.border && variantColors.borderPressed) {
            style.borderColor = interpolateColor(
                pressed.value,
                [0, 1],
                [variantColors.border, variantColors.borderPressed],
            );
        }
        return style;
    });

    const handlePressIn = disabled
        ? undefined
        : () => {
              pressed.value = withTiming(1, { duration: PRESS_DURATION_MS, easing: PRESS_EASING });
          };
    const handlePressOut = disabled
        ? undefined
        : () => {
              pressed.value = withTiming(0, { duration: PRESS_DURATION_MS, easing: PRESS_EASING });
          };

    return (
        <AnimatedPressable
            onPress={disabled ? undefined : onPress}
            onPressIn={handlePressIn}
            onPressOut={handlePressOut}
            disabled={disabled}
            accessibilityRole='button'
            accessibilityState={{ disabled }}
            accessibilityLabel={accessibilityLabel}
            className={styles.base()}
            style={animatedStyle}
        >
            {iconOnly ? (
                children
            ) : (
                <Text className={styles.label()} numberOfLines={1} pointerEvents='none'>
                    {children}
                </Text>
            )}
        </AnimatedPressable>
    );
}
