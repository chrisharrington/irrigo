import { Colours } from '@/constants/colours';
import { StyleSheet } from 'react-native';

export default StyleSheet.create({
    container: {
        width: '100%',
        gap: 12,
        overflow: 'hidden',
    },

    entry: {
        flex: 1,
        flexDirection: 'row',
        gap: 24,
    },

    entryLabel: {
        flex: 1,
        color: Colours.subtext,
        flexWrap: 'wrap',
    },

    entryValue: {
        flex: 3,
        color: Colours.text,
        textAlign: 'left',
    },
});
