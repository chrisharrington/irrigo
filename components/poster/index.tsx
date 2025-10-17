import React from 'react';
import { Image, View } from 'react-native';
import styles from './style';

/**
 * Props interface for the Poster component.
 * @interface PosterProps
 * @property {string} url - The URL of the poster image to display
 * @property {boolean} isBusy - Indicates if the component is in a loading state
 */
export type PosterProps = {
    url: string;
};

/**
 * Poster component displays a movie poster image at standard proportions.
 *
 * @property url - Required. The image URL to display.
 */
export function Poster({ url }: PosterProps) {
    return (
        <View style={styles.container} testID='poster'>
            <Image source={{ uri: url }} style={styles.image} />
        </View>
    );
}

export default Poster;
