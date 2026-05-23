import { useCallback, useState, type ReactNode } from 'react';
import { TextInput, View, Text, type TextInputProps } from 'react-native';
import { tv, type VariantProps } from 'tailwind-variants';

import config from '../../tailwind.config';

const colors = config.theme.extend.colors;

const input = tv({
    slots: {
        // Layout, sizing & spacing + typography defaults shared by every state.
        base: 'h-[44px] w-full px-[14px] rounded-r-1 border font-sans text-fg text-[14px]',
    },
    variants: {
        focused: {
            true: { base: 'border-accent bg-bg shadow-[0_0_0_4px_rgba(111,227,155,0.06)]' },
            false: { base: 'bg-surface border-border' },
        },
        invalid: {
            true: { base: 'border-danger bg-surface shadow-[0_0_0_4px_rgba(255,107,123,0.08)]' },
            false: {},
        },
        disabled: {
            true: { base: 'opacity-40' },
            false: {},
        },
    },
    defaultVariants: { focused: false, invalid: false, disabled: false },
});

type InputVariants = VariantProps<typeof input>;

type AllowedTextInputProps = Pick<
    TextInputProps,
    'keyboardType' | 'autoCapitalize' | 'autoCorrect' | 'autoFocus' | 'secureTextEntry' | 'maxLength' | 'returnKeyType' | 'onSubmitEditing'
>;

/**
 * Props for the Irrigo input primitive.
 */
export type InputProps = AllowedTextInputProps & {
    /** Required. Controlled value. */
    value: string;

    /** Required. Fires with the next value on every keystroke (unless `disabled`). */
    onChangeText: (next: string) => void;

    /** Optional. Placeholder text rendered when `value` is empty. */
    placeholder?: string;

    /** Optional. Paints the danger border + red wash. Defaults to `false`. */
    invalid?: InputVariants['invalid'];

    /** Optional. Disables editing and dims the control. Defaults to `false`. */
    disabled?: InputVariants['disabled'];

    /** Optional. Accessibility label. Defaults to the placeholder when one is supplied. */
    accessibilityLabel?: string;
};

/**
 * The Irrigo text input primitive — 44px tall, surface background, border,
 * 4px radii. Focus state paints the accent border + the 4px green wash
 * shadow from the design CSS. `invalid` swaps to the danger border + red
 * wash. The control owns its own focused boolean so the green wash tracks
 * the actual UIKit / Android focus state without callers having to hold it.
 */
export function Input({
    value,
    onChangeText,
    placeholder,
    invalid = false,
    disabled = false,
    accessibilityLabel,
    ...rest
}: InputProps) {
    const [focused, setFocused] = useState<boolean>(false);

    const handleFocus = useCallback(() => setFocused(true), []);
    const handleBlur = useCallback(() => setFocused(false), []);

    const styles = input({ focused, invalid, disabled });

    return (
        <TextInput
            value={value}
            onChangeText={disabled ? undefined : onChangeText}
            onFocus={handleFocus}
            onBlur={handleBlur}
            placeholder={placeholder}
            placeholderTextColor={colors['fg-dim']}
            editable={!disabled}
            accessibilityLabel={accessibilityLabel ?? placeholder}
            className={styles.base()}
            {...rest}
        />
    );
}

/**
 * Props for the `<Field>` wrapper.
 */
export type FieldProps = {
    /** Optional. Label text rendered above the field. */
    label?: string;

    /** Optional. Helper text rendered below the field. Suppressed when `err` is set. */
    hint?: string;

    /** Optional. Error text rendered below the field in `danger` color. Overrides the hint when present. */
    err?: string;

    /** Required. The control rendered inside the field (typically `<Input>`). */
    children: ReactNode;
};

/**
 * Column-flex wrapper that pairs a label, control, and either a hint or
 * error message. Matches the `.field` recipe from the design CSS. The
 * control sits between the label and the hint/err row. When `err` is
 * truthy, the hint is suppressed and the error replaces it in `danger`
 * color.
 */
export function Field({ label, hint, err, children }: FieldProps) {
    return (
        <View className='flex-col gap-2'>
            {label !== undefined && (
                <Text className='font-sans-medium text-fg-soft text-[12px] leading-[16px]'>{label}</Text>
            )}
            {children}
            {err !== undefined ? (
                <Text className='font-sans text-danger text-[12px] leading-[17px]'>{err}</Text>
            ) : hint !== undefined ? (
                <Text className='font-sans text-fg-muted text-[12px] leading-[17px]'>{hint}</Text>
            ) : null}
        </View>
    );
}
