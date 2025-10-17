import { Colours } from '@/constants/colours';
import { StyleSheet } from 'react-native';

export const spinnerSizes = {
    sm: 24,
    md: 36,
    lg: 48,
    xl: 64,
};

const styles = StyleSheet.create({
    spinner: {
        justifyContent: 'center',
        alignItems: 'center',
    },
    circle: {
        borderWidth: 3,
        borderRadius: 999,
        borderTopColor: Colours.primary,
        borderRightColor: Colours.background2,
        borderLeftColor: Colours.background2,
        borderBottomColor: Colours.background2,
    },
});

export default styles;
