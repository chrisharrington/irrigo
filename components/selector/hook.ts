import { useFocusEffect } from '@react-navigation/native';
import { useEffect, useRef, useState } from 'react';
import { Animated, BackHandler, Dimensions, Easing } from 'react-native';
import { useToast } from '../toast';

const { height: screenHeight } = Dimensions.get('window');

/**
 * A hook that manages the animation and visibility state of a selector component.
 * This hook manages two parallel animations: a slide animation that moves the selector
 * from the bottom of the screen and a fade animation that controls the opacity.
 *
 * @param {boolean} visible - Boolean flag indicating whether the selector should be visible
 * @param {(value: string | null) => void} [onSelectValue] - Optional callback function called when a value is selected
 * @param {() => void} [onClose] - Optional callback function called when the selector is closed
 * @returns {Object} Object containing:
 * - slideAnim: Animated.Value for slide animation
 * - fadeAnim: Animated.Value for fade animation
 * - isVisible: Boolean indicating if selector is currently visible
 * - handleSelectValue: Callback function to handle value selection
 */
export function useSelector(visible: boolean, onSelectValue?: (value: string | null) => void, onClose?: () => void) {
    const slideAnim = useRef(new Animated.Value(screenHeight)).current,
        fadeAnim = useRef(new Animated.Value(0)).current,
        [isVisible, setIsVisible] = useState(false),
        toast = useToast();

    // Handle hardware back button to close selector instead of navigating back.
    useFocusEffect(() => {
        const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
            if (visible && isVisible) {
                // Close selector instead of going back.
                if (onClose) onClose();
                return true; // Prevent default back behavior.
            }
            return false; // Allow default back behavior.
        });
        return () => subscription.remove();
    });

    useEffect(() => {
        if (visible) {
            // Show the selector.
            setIsVisible(true);

            // Run slide up and fade in animations in parallel.
            Animated.parallel([
                // Animate selector sliding up from bottom.
                Animated.timing(slideAnim, {
                    toValue: 0,
                    duration: 350,
                    easing: Easing.out(Easing.cubic),
                    useNativeDriver: true,
                }),

                // Animate selector fading in.
                Animated.timing(fadeAnim, {
                    toValue: 1,
                    duration: 300,
                    easing: Easing.out(Easing.quad),
                    useNativeDriver: true,
                }),
            ]).start();
        } else if (isVisible) {
            // Hide any toasts that may be visible.
            toast.hide();

            // Run slide down and fade out animations in parallel.
            Animated.parallel([
                // Animate selector sliding down to bottom.
                Animated.timing(slideAnim, {
                    toValue: screenHeight,
                    duration: 280,
                    easing: Easing.in(Easing.cubic),
                    useNativeDriver: true,
                }),

                // Animate selector fading out.
                Animated.timing(fadeAnim, {
                    toValue: 0,
                    duration: 250,
                    easing: Easing.in(Easing.quad),
                    useNativeDriver: true,
                }),
            ]).start(() => {
                setIsVisible(false);
            });
        }
    }, [visible, slideAnim, fadeAnim, isVisible, toast]);

    return {
        slideAnim,
        fadeAnim,
        isVisible,
        handleSelectValue,
    };

    /**
     * Handles the selection of a value from a selector component.
     * Calls the onSelectValue handler with the selected value and closes the selector.
     *
     * @param {string | null} value - The selected value, which can be either a string or null
     */
    function handleSelectValue(value: string | null) {
        if (onSelectValue) onSelectValue(value);
        if (onClose) onClose();
    }
}
