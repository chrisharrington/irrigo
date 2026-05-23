import type { ReactNode } from 'react';
import { Pressable, Text } from 'react-native';
import { tv, type VariantProps } from 'tailwind-variants';

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
                base: 'bg-accent active:bg-accent-deep shadow-glow-accent',
                label: 'text-on-accent active:text-chalk-50',
            },
            secondary: {
                base: 'bg-surface border-border active:bg-surface-2 active:border-border-strong',
                label: 'text-fg',
            },
            ghost: {
                base: 'active:bg-surface',
                label: 'text-fg-soft active:text-fg',
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
 * `app/design/irrigo/project/components.css`: primary (accent fill, deep on
 * press, glow shadow), secondary (surface fill, border, lifts to surface-2
 * on press), and ghost (transparent, fills to surface on press). The
 * `iconOnly` prop drops horizontal padding and locks the width equal to the
 * height for a square hit target.
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
    return (
        <Pressable
            onPress={disabled ? undefined : onPress}
            disabled={disabled}
            accessibilityRole='button'
            accessibilityState={{ disabled }}
            accessibilityLabel={accessibilityLabel}
            className={styles.base()}
        >
            {iconOnly ? (
                children
            ) : (
                <Text className={styles.label()} numberOfLines={1}>
                    {children}
                </Text>
            )}
        </Pressable>
    );
}
