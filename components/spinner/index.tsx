import React from 'react';
import { Animated, View } from 'react-native';
import { useSpinner } from './hook';
import styles from './style';

export type SpinnerSize = 'sm' | 'md' | 'lg' | 'xl';

/**
 * Spinner component displays a rotating loading indicator.
 *
 * @property size - Required. Spinner size: 'sm', 'md', 'lg', or 'xl'.
 * @property testID - Optional. Test identifier for testing purposes.
 */
export function Spinner({ size = 'md', testID }: { size?: SpinnerSize; testID?: string }) {
    const { diameter, rotate } = useSpinner(size);

    return (
        <View style={[styles.spinner, { width: diameter, height: diameter }]} testID={testID}>
            <Animated.View
                style={[
                    styles.circle,
                    {
                        width: diameter,
                        height: diameter,
                        transform: [{ rotate }],
                    },
                ]}
            />
        </View>
    );
}

export default Spinner;
