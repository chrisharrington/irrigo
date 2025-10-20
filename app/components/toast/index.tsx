import React, { createContext, ReactNode, useContext, useEffect, useRef, useState } from 'react';
import { Animated, Text, View } from 'react-native';
import { Portal } from 'react-native-portalize';
import styles from './style';

type ToastType = 'success' | 'error';

type ToastMessage = {
    message: string;
    type: ToastType;
};

type ToastContextType = {
    /** Required. Function to display a success toast with the specified message. */
    success: (message: string) => void;

    /** Required. Function to display an error toast with the specified message. */
    error: (message: string, error?: any) => void;

    /** Required. Function to immediately hide any currently visible toast. */
    hide: () => void;
};

const ToastContext = createContext<ToastContextType | undefined>(undefined);

type ToastProviderProps = {
    children: ReactNode;
};

/**
 * Provider component that manages toast notifications throughout the application.
 * Displays temporary messages with animations. Only one toast is visible at a time.
 * Toasts are automatically dismissed after 5 seconds.
 *
 * @param {Object} props - Component props
 * @param {ReactNode} props.children - Child components that will have access to toast context
 */
export function ToastProvider({ children }: ToastProviderProps) {
    const [currentToast, setCurrentToast] = useState<ToastMessage | null>(null),
        translateY = useRef(new Animated.Value(50)).current,
        opacity = useRef(new Animated.Value(0)).current,
        dismissTimeoutRef = useRef<NodeJS.Timeout | null>(null),
        isToastVisibleRef = useRef<boolean>(false);

    // Cleanup timers when component unmounts.
    useEffect(() => {
        return () => {
            if (dismissTimeoutRef.current) {
                clearTimeout(dismissTimeoutRef.current);
                dismissTimeoutRef.current = null;
            }
        };
    }, []);

    return (
        <ToastContext.Provider
            value={{
                success,
                error,
                hide,
            }}
        >
            {children}
            <Portal>
                <View style={styles.container} pointerEvents='none'>
                    {currentToast && <Toast toast={currentToast} translateY={translateY} opacity={opacity} />}
                </View>
            </Portal>
        </ToastContext.Provider>
    );

    /**
     * Creates and displays a toast notification with fade and slide animations.
     * Automatically dismissed after 5 seconds.
     *
     * @param {string} message - Text message to display in the toast
     * @param {ToastType} type - Toast type ('success' or 'error') for styling
     */
    function showToast(message: string, type: ToastType) {
        // Clear any existing dismiss timer.
        if (dismissTimeoutRef.current) {
            clearTimeout(dismissTimeoutRef.current);
            dismissTimeoutRef.current = null;
        }

        const newToast: ToastMessage = {
            message,
            type,
        };

        if (isToastVisibleRef.current) {
            // Fade out current toast, update content, then fade back in.
            Animated.parallel([
                Animated.timing(opacity, {
                    toValue: 0,
                    duration: 200,
                    useNativeDriver: true,
                }),
                Animated.timing(translateY, {
                    toValue: 50,
                    duration: 200,
                    useNativeDriver: true,
                }),
            ]).start(() => {
                // Update toast content while invisible.
                setCurrentToast(newToast);

                // Fade back in.
                Animated.parallel([
                    Animated.timing(opacity, {
                        toValue: 1,
                        duration: 200,
                        useNativeDriver: true,
                    }),
                    Animated.timing(translateY, {
                        toValue: 0,
                        duration: 200,
                        useNativeDriver: true,
                    }),
                ]).start();
            });
        } else {
            // Show new toast with fade in animation.
            setCurrentToast(newToast);
            isToastVisibleRef.current = true;

            Animated.parallel([
                Animated.timing(opacity, {
                    toValue: 1,
                    duration: 300,
                    useNativeDriver: true,
                }),
                Animated.timing(translateY, {
                    toValue: 0,
                    duration: 300,
                    useNativeDriver: true,
                }),
            ]).start();
        }

        // Auto dismiss after 5 seconds.
        dismissTimeoutRef.current = setTimeout(() => {
            Animated.parallel([
                Animated.timing(opacity, {
                    toValue: 0,
                    duration: 300,
                    useNativeDriver: true,
                }),
                Animated.timing(translateY, {
                    toValue: 50,
                    duration: 300,
                    useNativeDriver: true,
                }),
            ]).start(() => {
                setCurrentToast(null);
                isToastVisibleRef.current = false;
            });
        }, 5000);
    }

    /**
     * Displays a success toast notification with green background.
     *
     * @param {string} message - Success message to display
     */
    function success(message: string) {
        showToast(message, 'success');
    }

    /**
     * Displays an error toast notification with red background.
     * Logs error details to console if provided.
     *
     * @param {string} message - Error message to display
     * @param {any} [error] - Optional error object to log
     */
    function error(message: string, error?: any) {
        showToast(message, 'error');
        if (error) console.error(error.stack ? error.stack : error);
    }

    /**
     * Immediately hides the currently visible toast notification.
     * Clears any pending dismiss timers and animates the toast out.
     */
    function hide() {
        if (dismissTimeoutRef.current) {
            clearTimeout(dismissTimeoutRef.current);
            dismissTimeoutRef.current = null;
        }

        Animated.parallel([
            Animated.timing(opacity, {
                toValue: 0,
                duration: 300,
                useNativeDriver: true,
            }),
            Animated.timing(translateY, {
                toValue: 50,
                duration: 300,
                useNativeDriver: true,
            }),
        ]).start(() => {
            setCurrentToast(null);
            isToastVisibleRef.current = false;
        });
    }
}

type ToastProps = {
    /** Required. The toast message and type to display. */
    toast: ToastMessage;

    /** Required. Animated value for vertical translation of the toast. */
    translateY: Animated.Value;

    /** Required. Animated value for the opacity of the toast. */
    opacity: Animated.Value;
};

function Toast({ toast, translateY, opacity }: ToastProps) {
    const toastStyle = toast.type === 'success' ? styles.successToast : styles.errorToast;

    return (
        <Animated.View
            style={[
                styles.toast,
                toastStyle,
                {
                    opacity,
                    transform: [{ translateY }],
                },
            ]}
        >
            <Text style={styles.toastText}>{toast.message}</Text>
        </Animated.View>
    );
}

/**
 * Hook that provides access to toast context methods.
 * Must be used within a ToastProvider component.
 *
 * @returns {ToastContextType} Toast context with success, error, and hide methods
 * @throws {Error} When used outside of ToastProvider
 */
export function useToast(): ToastContextType {
    const context = useContext(ToastContext);
    if (context === undefined) throw new Error('useToast must be used within a ToastProvider');
    return context;
}
