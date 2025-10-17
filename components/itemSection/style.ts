import { Colours } from '@/constants/colours';
import { StyleSheet } from 'react-native';

export default StyleSheet.create({
    item: {
        width: 120,
    },

    title: {
        fontSize: 13,
        fontFamily: 'Lato',
        color: Colours.text,
        overflow: 'hidden',
        marginTop: 6,
        fontWeight: 'bold',
    },

    year: {
        fontSize: 12,
        fontFamily: 'Lato',
        color: Colours.subtext,
        marginTop: 2,
    },

    posterContainer: {
        position: 'relative',
        overflow: 'hidden',
        borderRadius: 8,
    },

    itemProgressContainer: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        height: 4,
        backgroundColor: Colours.background3,
    },

    itemProgress: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        height: 4,
        backgroundColor: Colours.primary,
    },

    playedIndicator: {
        position: 'absolute',
        top: 8,
        right: 8,
        backgroundColor: 'white',
        borderRadius: 18,
    },
});
