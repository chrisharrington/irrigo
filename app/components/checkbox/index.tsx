import { Pressable, Text, View } from 'react-native';
import { tv, type VariantProps } from 'tailwind-variants';

const checkbox = tv({
    slots: {
        // Layout & Structure
        row: 'flex-row items-center gap-[10px]',
        // Sizing
        box: 'w-5 h-5 items-center justify-center rounded-r-1 border',
        // Typography
        label: 'font-sans text-fg-soft text-[14px] leading-[21px]',
    },
    variants: {
        checked: {
            true: { box: 'bg-accent border-accent' },
            false: { box: 'bg-surface border-border' },
        },
        disabled: {
            true: { row: 'opacity-40' },
            false: {},
        },
    },
    defaultVariants: { checked: false, disabled: false },
});

type CheckboxVariants = VariantProps<typeof checkbox>;

/**
 * Props for the Irrigo checkbox primitive.
 */
export type CheckboxProps = {
    /** Required. Controlled checked state. */
    value: boolean;

    /** Required. Fires with the negated value when the row is pressed (and not disabled). */
    onValueChange: (next: boolean) => void;

    /** Optional. Disables interaction and dims the control. Defaults to `false`. */
    disabled?: CheckboxVariants['disabled'];

    /** Optional. Overrides the accessibility label spoken by screen readers; defaults to the children string. */
    accessibilityLabel?: string;

    /** Required. Label text rendered next to the box. */
    children: string;
};

/**
 * The Irrigo checkbox primitive — a 20×20 box + label row, mirroring the
 * `.check` recipe from the design CSS. Used by the switch-profile modal
 * options. The check-mark is a small rotated `<View>` (RN can't render
 * `::after` borders, so we mimic the angle with `transform: [rotate(-45deg)]`
 * on a two-sided border square).
 */
export function Checkbox({
    value,
    onValueChange,
    disabled = false,
    accessibilityLabel,
    children,
}: CheckboxProps) {
    const styles = checkbox({ checked: value, disabled });

    return (
        <Pressable
            onPress={disabled ? undefined : () => onValueChange(!value)}
            disabled={disabled}
            accessibilityRole='checkbox'
            accessibilityLabel={accessibilityLabel ?? children}
            accessibilityState={{ checked: value, disabled }}
            className={styles.row()}
        >
            <View className={styles.box()}>
                {value && <CheckMark />}
            </View>
            <Text className={styles.label()}>{children}</Text>
        </Pressable>
    );
}

/**
 * Two-stroke checkmark glyph rendered when the box is checked. Built from
 * left + bottom borders of a small box rotated -45° — the trick the design
 * CSS uses with `::after`, ported to RN where pseudo-elements don't exist.
 */
function CheckMark() {
    return (
        <View
            accessibilityLabel='check'
            style={{
                width: 10,
                height: 6,
                borderLeftWidth: 2,
                borderBottomWidth: 2,
                borderColor: '#052013',
                transform: [{ rotate: '-45deg' }, { translateX: 1 }, { translateY: -1 }],
            }}
        />
    );
}
