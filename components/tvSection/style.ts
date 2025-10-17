import { Colours } from '@/constants/colours';
import { StyleSheet } from 'react-native';

export default StyleSheet.create({
    item: {
        width: 120,
    },

    title: {
        fontSize: 12,
        fontFamily: 'Lato',
        color: Colours.text,
        overflow: 'hidden',
    },

    year: {
        fontSize: 10,
        fontFamily: 'Lato',
        color: Colours.subtext,
    },
});
