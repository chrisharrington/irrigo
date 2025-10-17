import { Colours } from '@/constants/colours';
import { StyleSheet } from 'react-native';

export default StyleSheet.create({
    selectorWrapper: {
        flex: 1,
        shadowColor: '#000',
        shadowOffset: {
            width: 0,
            height: 2,
        },
        shadowOpacity: 0.15,
        shadowRadius: 3,
        elevation: 3,
        overflow: 'visible',
    },

    selectorButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: 'rgba(255,255,255,0.05)',
        borderRadius: 6,
        paddingHorizontal: 16,
        paddingVertical: 14,
        minHeight: 48,
    },

    selectorIcon: {
        marginRight: 12,
    },

    selectorText: {
        color: Colours.text,
        fontSize: 16,
        fontFamily: 'Lato-Regular',
        flex: 1,
    },
});
