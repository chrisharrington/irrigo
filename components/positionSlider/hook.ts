import { useMemo, useState } from 'react';
import { LayoutChangeEvent, LayoutRectangle } from 'react-native';
import { PositionSliderProps } from '.';

/**
 * Custom hook for managing PositionSlider state and behavior.
 * Handles slider value changes, thumb position calculation, and event forwarding.
 *
 * @param props - The PositionSlider props containing slider configuration and event handlers
 * @returns Object containing thumb position and event handlers
 */
export function usePositionSlider(props: PositionSliderProps) {
    const { onValueChange, onSlidingStart, onSlidingComplete } = props,
        [percentageThumbPosition, setPercentageThumbPosition] = useState<number>(0),
        [layout, setLayout] = useState<LayoutRectangle | null>(null);

    return {
        percentageThumbPosition,
        pixelThumbPosition: useMemo(
            () => (layout ? (percentageThumbPosition / 100) * layout.width : 0),
            [percentageThumbPosition, layout]
        ),
        maxPixelThumbPosition: useMemo(() => (layout ? layout.width : 0), [layout]),
        handleValueChange,
        handleSlidingStart,
        handleSlidingComplete,
        handleLayoutChangeEvent,
    };

    /**
     * Handle value change and update thumb position.
     * Updates internal state and forwards the event to parent handler.
     */
    function handleValueChange(percentageValue: number) {
        // Calculate new thumb position based on the updated value.
        setPercentageThumbPosition(percentageValue);

        // Forward the value change to the parent handler if provided.
        if (onValueChange) onValueChange(percentageValue);
    }

    /**
     * Handle sliding start event.
     * Updates thumb position and forwards the event to parent handler.
     */
    function handleSlidingStart(percentageValue: number) {
        // Set the percentage thumb position when sliding starts.
        setPercentageThumbPosition(percentageValue);

        // Forward the sliding start event to the parent handler if provided.
        if (onSlidingStart) onSlidingStart(percentageValue);
    }

    /**
     * Handle sliding complete event.
     * Updates final thumb position and forwards the event to parent handler.
     */
    function handleSlidingComplete(percentageValue: number) {
        // Set the final percentage thumb position when sliding completes.
        setPercentageThumbPosition(percentageValue);

        // Forward the sliding complete event to the parent handler if provided.
        if (onSlidingComplete) onSlidingComplete(percentageValue);
    }

    /**
     * Event handler for layout change events.
     * Updates the layout state with the new layout dimensions from the native event.
     * @param event - The layout change event containing the new layout dimensions
     */
    function handleLayoutChangeEvent(event: LayoutChangeEvent) {
        setLayout(event.nativeEvent.layout);
    }
}
