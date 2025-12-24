import { colours } from '@/constants/colours';
import { StyleSheet } from 'react-native';

export default StyleSheet.create({
    container: {
        marginBottom: 16,
    },

    label: {
        color: colours.text.DEFAULT,
        fontSize: 14,
        marginBottom: 6,
    },

    input: {
        backgroundColor: colours.background[200],
        borderRadius: 6,
        paddingHorizontal: 12,
        paddingVertical: 10,
        color: colours.text.DEFAULT,
        fontSize: 16,
    },

    inputError: {
        borderWidth: 1,
        borderColor: colours.error.DEFAULT,
    },

    error: {
        color: colours.error.DEFAULT,
        fontSize: 12,
        marginTop: 4,
    },
});
