import React from 'react';
import { Text, TextInput as RNTextInput, TextInputProps as RNTextInputProps, View } from 'react-native';
import { Control, Controller, FieldValues, Path } from 'react-hook-form';
import { colours } from '@/constants/colours';
import style from './style';

type TextInputProps<T extends FieldValues> = {
    name: Path<T>;
    control: Control<T>;
    label?: string;
    placeholder?: string;
    secureTextEntry?: boolean;
    keyboardType?: RNTextInputProps['keyboardType'];
    autoCapitalize?: RNTextInputProps['autoCapitalize'];
};

export function TextInput<T extends FieldValues>({
    name,
    control,
    label,
    placeholder,
    secureTextEntry,
    keyboardType,
    autoCapitalize = 'none',
}: TextInputProps<T>) {
    return (
        <Controller
            name={name}
            control={control}
            render={({ field: { onChange, onBlur, value }, fieldState: { error } }) => (
                <View style={style.container}>
                    {label && <Text style={style.label}>{label}</Text>}
                    <RNTextInput
                        style={[style.input, error && style.inputError]}
                        onChangeText={onChange}
                        onBlur={onBlur}
                        value={value}
                        placeholder={placeholder}
                        placeholderTextColor={colours.subtext.DEFAULT}
                        secureTextEntry={secureTextEntry}
                        keyboardType={keyboardType}
                        autoCapitalize={autoCapitalize}
                    />
                    {error && <Text style={style.error}>{error.message}</Text>}
                </View>
            )}
        />
    );
}
