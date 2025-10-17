import Slider, { SliderProps } from '@react-native-community/slider';
import React from 'react';
import { View } from 'react-native';
import { usePositionSlider } from './hook';
import style from './style';

export type PositionSliderResult = {
    /** The position of the thumb in pixels from the left edge. */
    pixelThumbPosition: number;

    /** The maximum pixel position of the thumb. */
    maxPixelThumbPosition: number;

    /** The position of the thumb represented as a percentage. */
    percentageThumbPosition: number;
};

export type PositionSliderProps = Omit<SliderProps, 'children'> & {
    /** Optional. Render prop function that receives the thumb position percentage (0-100). */
    children?: (result: PositionSliderResult) => React.ReactNode;
};

/**
 * PositionSlider component that wraps the @react-native-community/slider and provides
 * a render prop with the current thumb position as a percentage.
 *
 * @param props - Component props extending SliderProps with optional children render prop
 * @returns JSX element representing the position slider with optional children
 */
export function PositionSlider(props: PositionSliderProps) {
    const { children, ...sliderProps } = props,
        {
            pixelThumbPosition,
            maxPixelThumbPosition,
            percentageThumbPosition,
            handleValueChange,
            handleSlidingStart,
            handleSlidingComplete,
            handleLayoutChangeEvent,
        } = usePositionSlider(props);

    return (
        <View style={style.container}>
            <Slider
                {...sliderProps}
                onLayout={handleLayoutChangeEvent}
                onValueChange={handleValueChange}
                onSlidingStart={handleSlidingStart}
                onSlidingComplete={handleSlidingComplete}
            />
            {children &&
                children({
                    pixelThumbPosition,
                    maxPixelThumbPosition,
                    percentageThumbPosition,
                })}
        </View>
    );
}

PositionSlider.displayName = 'PositionSlider';
