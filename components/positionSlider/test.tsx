import { act, fireEvent, render, renderHook } from '@testing-library/react-native';
import React from 'react';
import { Text, View } from 'react-native';
import { PositionSlider, PositionSliderProps } from '.';
import { usePositionSlider } from './hook';

// Mock the @react-native-community/slider.
jest.mock('@react-native-community/slider', () => {
    const React = require('react');
    const { View } = require('react-native');

    return React.forwardRef((props: any, ref: any) => (
        <View ref={ref} testID='slider' onLayout={props.onLayout} {...props} />
    ));
});

describe('PositionSlider', () => {
    const defaultProps: PositionSliderProps = {
        minimumValue: 0,
        maximumValue: 100,
        value: 25,
    };

    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('Component rendering behavior', () => {
        it('renders without children', () => {
            // Render PositionSlider without children.
            const { getByTestId } = render(<PositionSlider {...defaultProps} />);

            // Verify the slider is rendered.
            expect(getByTestId('slider')).toBeTruthy();
        });

        it('renders with children render prop', () => {
            // Render PositionSlider with children render prop.
            const { getByTestId } = render(
                <PositionSlider {...defaultProps}>
                    {result => (
                        <View testID='render-prop-content'>
                            <Text testID='pixel-position'>{result.pixelThumbPosition}</Text>
                            <Text testID='max-pixel-position'>{result.maxPixelThumbPosition}</Text>
                            <Text testID='percentage-position'>{result.percentageThumbPosition}</Text>
                        </View>
                    )}
                </PositionSlider>
            );

            // Verify the render prop content is displayed.
            expect(getByTestId('render-prop-content')).toBeTruthy();
            expect(getByTestId('pixel-position')).toBeTruthy();
            expect(getByTestId('max-pixel-position')).toBeTruthy();
            expect(getByTestId('percentage-position')).toBeTruthy();
        });

        it('passes through slider props correctly', () => {
            // Render PositionSlider with additional slider props.
            const { getByTestId } = render(
                <PositionSlider
                    {...defaultProps}
                    minimumValue={10}
                    maximumValue={90}
                    value={50}
                    testID='custom-slider'
                />
            );

            // Verify the slider receives the props.
            const slider = getByTestId('custom-slider');
            expect(slider.props.minimumValue).toBe(10);
            expect(slider.props.maximumValue).toBe(90);
            expect(slider.props.value).toBe(50);
        });
    });

    describe('Event handling behavior', () => {
        it('calls onValueChange when slider value changes', () => {
            const mockOnValueChange = jest.fn();

            // Render PositionSlider with onValueChange handler.
            const { getByTestId } = render(<PositionSlider {...defaultProps} onValueChange={mockOnValueChange} />);

            // Simulate value change.
            const slider = getByTestId('slider');
            fireEvent(slider, 'onValueChange', 75);

            // Verify the handler was called.
            expect(mockOnValueChange).toHaveBeenCalledWith(75);
        });

        it('calls onSlidingStart when sliding begins', () => {
            const mockOnSlidingStart = jest.fn();

            // Render PositionSlider with onSlidingStart handler.
            const { getByTestId } = render(<PositionSlider {...defaultProps} onSlidingStart={mockOnSlidingStart} />);

            // Simulate sliding start.
            const slider = getByTestId('slider');
            fireEvent(slider, 'onSlidingStart', 30);

            // Verify the handler was called.
            expect(mockOnSlidingStart).toHaveBeenCalledWith(30);
        });

        it('calls onSlidingComplete when sliding ends', () => {
            const mockOnSlidingComplete = jest.fn();

            // Render PositionSlider with onSlidingComplete handler.
            const { getByTestId } = render(
                <PositionSlider {...defaultProps} onSlidingComplete={mockOnSlidingComplete} />
            );

            // Simulate sliding complete.
            const slider = getByTestId('slider');
            fireEvent(slider, 'onSlidingComplete', 60);

            // Verify the handler was called.
            expect(mockOnSlidingComplete).toHaveBeenCalledWith(60);
        });

        it('handles layout events correctly', () => {
            const mockLayoutEvent = {
                nativeEvent: {
                    layout: {
                        x: 0,
                        y: 0,
                        width: 300,
                        height: 40,
                    },
                },
            };

            // Render PositionSlider.
            const { getByTestId } = render(<PositionSlider {...defaultProps} />);

            // Simulate layout event.
            const slider = getByTestId('slider');
            fireEvent(slider, 'onLayout', mockLayoutEvent);

            // Layout event should be handled without errors.
            expect(getByTestId('slider')).toBeTruthy();
        });
    });

    describe('Position calculation behavior', () => {
        it('updates thumb position when value changes', () => {
            let renderResult: any;

            // Render PositionSlider with render prop to capture position.
            const { getByTestId, rerender } = render(
                <PositionSlider {...defaultProps} value={25}>
                    {result => {
                        renderResult = result;
                        return <View testID='position-display' />;
                    }}
                </PositionSlider>
            );

            // Simulate layout to set width.
            const slider = getByTestId('slider');
            fireEvent(slider, 'onLayout', {
                nativeEvent: {
                    layout: { x: 0, y: 0, width: 200, height: 40 },
                },
            });

            // Simulate value change to 50%.
            fireEvent(slider, 'onValueChange', 50);

            // Verify position calculations.
            expect(renderResult.percentageThumbPosition).toBe(50);
            expect(renderResult.maxPixelThumbPosition).toBe(200);
            expect(renderResult.pixelThumbPosition).toBe(100); // 50% of 200px
        });

        it('calculates pixel position correctly with different layouts', () => {
            let renderResult: any;

            // Render PositionSlider with different width.
            const { getByTestId } = render(
                <PositionSlider {...defaultProps} value={75}>
                    {result => {
                        renderResult = result;
                        return <View testID='position-display' />;
                    }}
                </PositionSlider>
            );

            // Simulate layout with 400px width.
            const slider = getByTestId('slider');
            fireEvent(slider, 'onLayout', {
                nativeEvent: {
                    layout: { x: 0, y: 0, width: 400, height: 40 },
                },
            });

            // Simulate value change to 25%.
            fireEvent(slider, 'onValueChange', 25);

            // Verify position calculations with new width.
            expect(renderResult.percentageThumbPosition).toBe(25);
            expect(renderResult.maxPixelThumbPosition).toBe(400);
            expect(renderResult.pixelThumbPosition).toBe(100); // 25% of 400px
        });

        it('handles zero width layout gracefully', () => {
            let renderResult: any;

            // Render PositionSlider.
            const { getByTestId } = render(
                <PositionSlider {...defaultProps} value={50}>
                    {result => {
                        renderResult = result;
                        return <View testID='position-display' />;
                    }}
                </PositionSlider>
            );

            // Simulate layout with zero width.
            const slider = getByTestId('slider');
            fireEvent(slider, 'onLayout', {
                nativeEvent: {
                    layout: { x: 0, y: 0, width: 0, height: 40 },
                },
            });

            // Verify zero width is handled correctly.
            expect(renderResult.maxPixelThumbPosition).toBe(0);
            expect(renderResult.pixelThumbPosition).toBe(0);
        });
    });
});

describe('usePositionSlider', () => {
    const defaultProps: PositionSliderProps = {
        minimumValue: 0,
        maximumValue: 100,
        value: 0,
    };

    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('Hook initialization behavior', () => {
        it('initializes with correct default state', () => {
            // Render the hook with default props.
            const { result } = renderHook(() => usePositionSlider(defaultProps));

            // Verify initial state.
            expect(result.current.percentageThumbPosition).toBe(0);
            expect(result.current.pixelThumbPosition).toBe(0);
            expect(result.current.maxPixelThumbPosition).toBe(0);
        });

        it('provides all expected handler functions', () => {
            // Render the hook.
            const { result } = renderHook(() => usePositionSlider(defaultProps));

            // Verify all handlers are functions.
            expect(typeof result.current.handleValueChange).toBe('function');
            expect(typeof result.current.handleSlidingStart).toBe('function');
            expect(typeof result.current.handleSlidingComplete).toBe('function');
            expect(typeof result.current.handleLayoutChangeEvent).toBe('function');
        });
    });

    describe('Value change handling behavior', () => {
        it('updates percentage position on value change', () => {
            const mockOnValueChange = jest.fn();

            // Render the hook with value change handler.
            const { result } = renderHook(() =>
                usePositionSlider({ ...defaultProps, onValueChange: mockOnValueChange })
            );

            // Simulate value change.
            act(() => {
                result.current.handleValueChange(75);
            });

            // Verify state update and handler call.
            expect(result.current.percentageThumbPosition).toBe(75);
            expect(mockOnValueChange).toHaveBeenCalledWith(75);
        });

        it('does not call onValueChange when handler is not provided', () => {
            // Render the hook without value change handler.
            const { result } = renderHook(() => usePositionSlider(defaultProps));

            // Simulate value change.
            act(() => {
                result.current.handleValueChange(50);
            });

            // Verify state update without errors.
            expect(result.current.percentageThumbPosition).toBe(50);
        });
    });

    describe('Sliding event handling behavior', () => {
        it('handles sliding start correctly', () => {
            const mockOnSlidingStart = jest.fn();

            // Render the hook with sliding start handler.
            const { result } = renderHook(() =>
                usePositionSlider({ ...defaultProps, onSlidingStart: mockOnSlidingStart })
            );

            // Simulate sliding start.
            act(() => {
                result.current.handleSlidingStart(30);
            });

            // Verify state update and handler call.
            expect(result.current.percentageThumbPosition).toBe(30);
            expect(mockOnSlidingStart).toHaveBeenCalledWith(30);
        });

        it('handles sliding complete correctly', () => {
            const mockOnSlidingComplete = jest.fn();

            // Render the hook with sliding complete handler.
            const { result } = renderHook(() =>
                usePositionSlider({ ...defaultProps, onSlidingComplete: mockOnSlidingComplete })
            );

            // Simulate sliding complete.
            act(() => {
                result.current.handleSlidingComplete(80);
            });

            // Verify state update and handler call.
            expect(result.current.percentageThumbPosition).toBe(80);
            expect(mockOnSlidingComplete).toHaveBeenCalledWith(80);
        });

        it('does not call sliding handlers when not provided', () => {
            // Render the hook without sliding handlers.
            const { result } = renderHook(() => usePositionSlider(defaultProps));

            // Simulate sliding events.
            act(() => {
                result.current.handleSlidingStart(25);
                result.current.handleSlidingComplete(75);
            });

            // Verify state updates without errors.
            expect(result.current.percentageThumbPosition).toBe(75);
        });
    });

    describe('Layout handling behavior', () => {
        it('updates layout and calculates pixel positions correctly', () => {
            // Render the hook.
            const { result } = renderHook(() => usePositionSlider(defaultProps));

            // Simulate layout change.
            act(() => {
                result.current.handleLayoutChangeEvent({
                    nativeEvent: {
                        layout: { x: 10, y: 20, width: 300, height: 40 },
                    },
                } as any);
            });

            // Verify layout update.
            expect(result.current.maxPixelThumbPosition).toBe(300);

            // Set a percentage and verify pixel calculation.
            act(() => {
                result.current.handleValueChange(60);
            });

            expect(result.current.pixelThumbPosition).toBe(180); // 60% of 300px
        });

        it('handles multiple layout changes correctly', () => {
            // Render the hook.
            const { result } = renderHook(() => usePositionSlider(defaultProps));

            // Set initial percentage.
            act(() => {
                result.current.handleValueChange(50);
            });

            // Simulate first layout.
            act(() => {
                result.current.handleLayoutChangeEvent({
                    nativeEvent: {
                        layout: { x: 0, y: 0, width: 200, height: 40 },
                    },
                } as any);
            });

            expect(result.current.pixelThumbPosition).toBe(100); // 50% of 200px

            // Simulate layout change with different width.
            act(() => {
                result.current.handleLayoutChangeEvent({
                    nativeEvent: {
                        layout: { x: 0, y: 0, width: 400, height: 40 },
                    },
                } as any);
            });

            expect(result.current.pixelThumbPosition).toBe(200); // 50% of 400px
        });
    });

    describe('Edge case handling behavior', () => {
        it('handles zero percentage correctly', () => {
            // Render the hook.
            const { result } = renderHook(() => usePositionSlider(defaultProps));

            // Set layout.
            act(() => {
                result.current.handleLayoutChangeEvent({
                    nativeEvent: {
                        layout: { x: 0, y: 0, width: 300, height: 40 },
                    },
                } as any);
            });

            // Set zero percentage.
            act(() => {
                result.current.handleValueChange(0);
            });

            // Verify zero pixel position.
            expect(result.current.percentageThumbPosition).toBe(0);
            expect(result.current.pixelThumbPosition).toBe(0);
        });

        it('handles maximum percentage correctly', () => {
            // Render the hook.
            const { result } = renderHook(() => usePositionSlider(defaultProps));

            // Set layout.
            act(() => {
                result.current.handleLayoutChangeEvent({
                    nativeEvent: {
                        layout: { x: 0, y: 0, width: 300, height: 40 },
                    },
                } as any);
            });

            // Set maximum percentage.
            act(() => {
                result.current.handleValueChange(100);
            });

            // Verify maximum pixel position.
            expect(result.current.percentageThumbPosition).toBe(100);
            expect(result.current.pixelThumbPosition).toBe(300);
        });

        it('handles layout without width gracefully', () => {
            // Render the hook.
            const { result } = renderHook(() => usePositionSlider(defaultProps));

            // Set percentage before layout.
            act(() => {
                result.current.handleValueChange(50);
            });

            // Verify zero pixel position without layout.
            expect(result.current.pixelThumbPosition).toBe(0);
            expect(result.current.maxPixelThumbPosition).toBe(0);
        });
    });
});
