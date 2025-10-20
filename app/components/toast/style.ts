import { Colours } from '@/constants/colours';
import { StyleSheet } from 'react-native';

export default StyleSheet.create({
    container: {
        position: 'absolute',
        left: 16,
        right: 16,
        bottom: 16,
        zIndex: 9999,
    },

    toast: {
        width: '100%',
        paddingHorizontal: 16,
        paddingVertical: 16,
        borderRadius: 4,
        shadowColor: '#000',
        shadowOpacity: 1,
        shadowRadius: 6,
        elevation: 8,
    },

    successToast: {
        backgroundColor: Colours.primary, // Green background for success
    },

    errorToast: {
        backgroundColor: Colours.error, // Red background for error
    },

    toastText: {
        color: Colours.text,
        fontSize: 16,
        fontWeight: '500',
        textAlign: 'left',
    },
});
