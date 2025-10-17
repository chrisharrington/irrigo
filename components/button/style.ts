import { Colours } from '@/constants/colours';
import { StyleSheet } from 'react-native';

export default StyleSheet.create({
    button: {
        borderRadius: 6,
        width: '100%',
        paddingHorizontal: 18,
        justifyContent: 'center',
        alignItems: 'center',
        height: 40,
    },

    primaryButton: {
        backgroundColor: Colours.primary,
    },

    secondaryButton: {
        backgroundColor: Colours.background3,
    },

    text: {
        color: Colours.text,
    },
});
