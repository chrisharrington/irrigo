import React from 'react';
import { Text, TouchableOpacity } from 'react-native';
import style from './style';

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

export function PrimaryButton({ onPress, isDisabled, text, children }: ButtonProps) {
    return (
        <TouchableOpacity
            activeOpacity={0.7}
            disabled={isDisabled}
            onPress={onPress}
            style={[style.button, style.primaryButton]}
        >
            {text ? <Text style={style.text}>{text}</Text> : children}
        </TouchableOpacity>
    );
}

export function SecondaryButton({ onPress, isDisabled, text, children }: ButtonProps) {
    return (
        <TouchableOpacity
            activeOpacity={0.7}
            disabled={isDisabled}
            onPress={onPress}
            style={[style.button, style.secondaryButton]}
        >
            {text ? <Text style={style.text}>{text}</Text> : children}
        </TouchableOpacity>
    );
}
