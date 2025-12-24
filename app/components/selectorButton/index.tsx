import { Selector } from '@/components/selector';
import { Colours } from '@/constants/colours';
import { LabelValue } from '@/models';
import { MaterialIcons } from '@expo/vector-icons';
import { Text, TouchableOpacity, View } from 'react-native';
import { useSelectorButton } from './hook';
import styles from './style';

type SelectorButtonProps = {
    /** Required. Array of options to display in the selector. */
    options: Array<LabelValue>;

    /** Required. Currently selected value, or null if none selected. */
    selectedValue: string | null;

    /** Required. Callback function when a value is selected. */
    onSelectValue: (value: string | null) => void;

    /** Required. Title displayed at the top of the selector modal. */
    title: string;

    /** Optional. MaterialIcons icon name to display before the selector text. */
    iconName?: keyof typeof MaterialIcons.glyphMap;

    /** Required. Text to display when no value is selected. */
    defaultLabel: string;

    /** Required. Prefix for test IDs used in components. */
    testIdPrefix: string;
};

export function SelectorButton({
    options,
    selectedValue,
    onSelectValue,
    title,
    iconName,
    defaultLabel,
    testIdPrefix,
}: SelectorButtonProps) {
    const { getSelectedLabel, showModal, setShowModal } = useSelectorButton();

    return (
        <>
            <View style={styles.selectorWrapper} testID={`${testIdPrefix}-wrapper`}>
                <TouchableOpacity
                    activeOpacity={0.7}
                    onPress={() => setShowModal(true)}
                    testID={`${testIdPrefix}-button`}
                >
                    <View style={styles.selectorButton}>
                        {iconName && (
                            <MaterialIcons name={iconName} size={20} color={Colours.text} style={styles.selectorIcon} />
                        )}
                        <Text style={styles.selectorText}>
                            {getSelectedLabel(options, selectedValue, defaultLabel)}
                        </Text>
                        <MaterialIcons name='keyboard-arrow-down' size={20} color={Colours.text} />
                    </View>
                </TouchableOpacity>
            </View>

            <Selector
                visible={showModal}
                onClose={() => setShowModal(false)}
                title={title}
                icon={iconName}
                options={options}
                selectedValue={selectedValue}
                onSelectValue={onSelectValue}
            />
        </>
    );
}
