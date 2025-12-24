import { colours } from '@/constants/colours';
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
        borderTopColor: colours.primary.DEFAULT,
        borderRightColor: colours.background[300],
        borderLeftColor: colours.background[300],
        borderBottomColor: colours.background[300],
    },
});

export default styles;
