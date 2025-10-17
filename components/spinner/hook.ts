import { useEffect, useRef } from 'react';
import { Animated, Easing } from 'react-native';
import { spinnerSizes } from './style';

/**
 * Hook for spinner animation and sizing.
 *
 * @param size - Spinner size: 'sm', 'md', 'lg', or 'xl'.
 * @returns diameter and animated rotation value.
 */
export function useSpinner(size: 'sm' | 'md' | 'lg' | 'xl' = 'md') {
    const spinAnim = useRef(new Animated.Value(0)).current;
    const diameter = spinnerSizes[size] || spinnerSizes.md;

    useEffect(() => {
        spinAnim.setValue(0);
        Animated.loop(
            Animated.timing(spinAnim, {
                toValue: 1,
                duration: 800,
                easing: Easing.linear,
                useNativeDriver: true,
                isInteraction: false,
            })
        ).start();
    }, [spinAnim]);

    const rotate = spinAnim.interpolate({
        inputRange: [0, 1],
        outputRange: ['0deg', '360deg'],
    });

    return { diameter, rotate };
}
