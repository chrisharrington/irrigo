import { colours } from '@/constants/colours';
import { StyleSheet } from 'react-native';

export const styles = StyleSheet.create({
    overlay: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'rgba(0,0,0,0.5)',
        justifyContent: 'flex-end',
        zIndex: 1000,
    },

    backdrop: {
        flex: 1,
    },

    slideUpContainer: {
        backgroundColor: colours.background[300],
        borderTopLeftRadius: 6,
        borderTopRightRadius: 6,
        maxHeight: '70%',
        shadowColor: '#000',
        shadowOffset: {
            width: 0,
            height: -2,
        },
        shadowOpacity: 0.25,
        shadowRadius: 3.84,
        elevation: 5,
    },

    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 20,
        paddingVertical: 16,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(255,255,255,0.1)',
    },

    icon: {
        marginRight: 12,
    },

    title: {
        color: colours.text.DEFAULT,
        fontSize: 18,
        fontFamily: 'Lato-Bold',
        flex: 1,
    },

    content: {
        maxHeight: 300,
        marginBottom: 48,
    },

    option: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 20,
        paddingVertical: 16,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(255,255,255,0.05)',
    },

    selectedOption: {
        backgroundColor: 'rgba(255,255,255,0.1)',
    },

    optionText: {
        color: colours.text.DEFAULT,
        fontSize: 16,
        fontFamily: 'Lato-Regular',
        flex: 1,
    },

    selectedOptionText: {
        color: colours.primary.DEFAULT,
        fontFamily: 'Lato-Bold',
    },
});
