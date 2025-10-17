import { StyleSheet } from 'react-native';

export const POSTER_WIDTH = 120;
export const POSTER_HEIGHT = 180;

const styles = StyleSheet.create({
    container: {
        borderRadius: 8,
        overflow: 'hidden',
        backgroundColor: '#222',
        borderWidth: 1,
        borderStyle: 'solid',
        borderColor: '#333',
    },

    image: {
        width: 120,
        aspectRatio: 2 / 3,
        resizeMode: 'contain',
    },
});

export default styles;
