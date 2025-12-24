import React from 'react';
import { Text, TouchableOpacity } from 'react-native';

export type ButtonProps = {
    /** Optional. The function to call when the user presses the button. */
    onPress?: () => void;

    /** Optional. If true, the button will be disabled. */
    isDisabled?: boolean;

    /** Optional. The text content of the button. */
    text?: string;

    /** Optional. The non-text content of the button. */
    children?: React.ReactNode;
};

const baseButtonClass = 'rounded-md w-full px-[18px] justify-center items-center h-10',
    textClass = 'text-text uppercase font-bold tracking text-base';

export function PrimaryButton({ onPress, isDisabled, text, children }: ButtonProps) {
    return (
        <TouchableOpacity
            activeOpacity={0.7}
            disabled={isDisabled}
            onPress={onPress}
            className={`${baseButtonClass} bg-primary`}
        >
            {text ?
                <Text className={textClass}>{text}</Text>
            :   children}
        </TouchableOpacity>
    );
}

export function SecondaryButton({ onPress, isDisabled, text, children }: ButtonProps) {
    return (
        <TouchableOpacity
            activeOpacity={0.7}
            disabled={isDisabled}
            onPress={onPress}
            className={`${baseButtonClass} bg-background-200`}
        >
            {text ?
                <Text className={textClass}>{text}</Text>
            :   children}
        </TouchableOpacity>
    );
}
