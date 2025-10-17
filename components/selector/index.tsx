import { Colours } from '@/constants/colours';
import { LabelValue } from '@/models';
import { MaterialIcons } from '@expo/vector-icons';
import { Animated, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { Portal } from 'react-native-portalize';
import { useSelector } from './hook';
import { styles as style } from './style';

type SelectorProps = {
    /** Required. Controls the visibility of the selector modal. */
    visible: boolean;

    /** Required. Callback function invoked when the selector should be closed. */
    onClose: () => void;

    /** Required. The title text displayed in the selector header. */
    title: string;

    /** Optional. The Material Icons icon name to display in the header. */
    icon?: keyof typeof MaterialIcons.glyphMap;

    /** Required. Array of selectable options to display in the selector. */
    options: LabelValue[];

    /** Required. The currently selected value, or null if no selection. */
    selectedValue: string | null;

    /** Required. Callback function invoked when a new value is selected. */
    onSelectValue: (value: string | null) => void;
};

export function Selector({ visible, onClose, title, icon, options, selectedValue, onSelectValue }: SelectorProps) {
    const { slideAnim, fadeAnim, isVisible, handleSelectValue } = useSelector(visible, onSelectValue, onClose);

    return !isVisible ? null : (
        <Portal>
            <Animated.View style={[style.overlay, { opacity: fadeAnim }]}>
                <TouchableOpacity style={style.backdrop} activeOpacity={1} onPress={onClose} testID='backdrop' />
                <Animated.View
                    style={[
                        style.slideUpContainer,
                        {
                            transform: [{ translateY: slideAnim }],
                        },
                    ]}
                >
                    <View style={style.header}>
                        {icon && <MaterialIcons style={style.icon} name={icon} size={24} color={Colours.text} />}
                        <Text style={style.title}>{title}</Text>
                        <TouchableOpacity
                            onPress={onClose}
                            style={{
                                padding: 8,
                                margin: -8,
                            }}
                            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                        >
                            <MaterialIcons name='close' size={24} color={Colours.text} />
                        </TouchableOpacity>
                    </View>
                    <ScrollView style={style.content}>
                        {options.map(option => (
                            <TouchableOpacity
                                key={option.value}
                                style={[style.option, selectedValue === option.value && style.selectedOption]}
                                activeOpacity={0.7}
                                onPress={() => handleSelectValue(option.value)}
                            >
                                <Text
                                    style={[
                                        style.optionText,
                                        selectedValue === option.value && style.selectedOptionText,
                                    ]}
                                >
                                    {option.label}
                                </Text>
                                {selectedValue === option.value && (
                                    <MaterialIcons name='check' size={20} color={Colours.primary} />
                                )}
                            </TouchableOpacity>
                        ))}
                    </ScrollView>
                </Animated.View>
            </Animated.View>
        </Portal>
    );
}
