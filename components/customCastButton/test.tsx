import { useCast } from '@/contexts/cast';
import { fireEvent, render } from '@testing-library/react-native';
import React from 'react';
import { TouchableOpacity } from 'react-native';
import { CustomCastButton } from '.';

/**
 * Test suite for CustomCastButton component - Cast Connection Button.
 * This file tests the functionality of the cast button including
 * connection state display, press handling, and visual customization.
 */

// Mock the cast context.
jest.mock('@/contexts/cast', () => ({
    useCast: jest.fn(),
}));

// Mock MaterialIcons from Expo vector icons.
jest.mock('@expo/vector-icons', () => ({
    MaterialIcons: ({ name, size, color, testID }: any) => {
        const { Text } = require('react-native');
        return <Text testID={testID || 'material-icon'}>{`${name}-${size}-${color}`}</Text>;
    },
}));

describe('CustomCastButton - Cast Connection Button', () => {
    const mockUseCast = useCast as jest.MockedFunction<typeof useCast>;

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('renders cast button when not connected', () => {
        // Mock cast context to return not connected state.
        mockUseCast.mockReturnValue({
            isConnected: false,
        } as any);

        const { getByTestId } = render(<CustomCastButton />);

        // Verify the TouchableOpacity is rendered.
        const touchableOpacity = getByTestId('material-icon').parent;
        expect(touchableOpacity).toBeTruthy();

        // Verify the correct icon is displayed for disconnected state.
        expect(getByTestId('material-icon')).toHaveTextContent('cast-24-white');
    });

    it('renders cast-connected icon when connected', () => {
        // Mock cast context to return connected state.
        mockUseCast.mockReturnValue({
            isConnected: true,
        } as any);

        const { getByTestId } = render(<CustomCastButton />);

        // Verify the correct icon is displayed for connected state.
        expect(getByTestId('material-icon')).toHaveTextContent('cast-connected-24-white');
    });

    it('applies custom tint color', () => {
        // Mock cast context.
        mockUseCast.mockReturnValue({
            isConnected: false,
        } as any);

        const customColor = '#ff6b6b';
        const { getByTestId } = render(<CustomCastButton tintColor={customColor} />);

        // Verify the custom color is applied to the icon.
        expect(getByTestId('material-icon')).toHaveTextContent(`cast-24-${customColor}`);
    });

    it('applies custom size', () => {
        // Mock cast context.
        mockUseCast.mockReturnValue({
            isConnected: false,
        } as any);

        const customSize = 32;
        const { getByTestId } = render(<CustomCastButton size={customSize} />);

        // Verify the custom size is applied to the icon.
        expect(getByTestId('material-icon')).toHaveTextContent(`cast-${customSize}-white`);
    });

    it('applies both custom size and color together', () => {
        // Mock cast context.
        mockUseCast.mockReturnValue({
            isConnected: true,
        } as any);

        const customSize = 30;
        const customColor = 'blue';
        const { getByTestId } = render(<CustomCastButton size={customSize} tintColor={customColor} />);

        // Verify both custom size and color are applied.
        expect(getByTestId('material-icon')).toHaveTextContent(`cast-connected-${customSize}-${customColor}`);
    });

    it('calls onPress when button is pressed', () => {
        // Mock cast context.
        mockUseCast.mockReturnValue({
            isConnected: false,
        } as any);

        const mockOnPress = jest.fn();
        const { UNSAFE_getByType } = render(<CustomCastButton onPress={mockOnPress} />);

        const button = UNSAFE_getByType(TouchableOpacity);

        // Simulate button press.
        fireEvent.press(button);

        // Verify onPress callback was called.
        expect(mockOnPress).toHaveBeenCalledTimes(1);
    });

    it('works without onPress callback', () => {
        // Mock cast context.
        mockUseCast.mockReturnValue({
            isConnected: false,
        } as any);

        const { UNSAFE_getByType } = render(<CustomCastButton />);

        const button = UNSAFE_getByType(TouchableOpacity);

        // Simulate button press without onPress prop - should not throw.
        expect(() => {
            fireEvent.press(button);
        }).not.toThrow();
    });

    it('applies custom style', () => {
        // Mock cast context.
        mockUseCast.mockReturnValue({
            isConnected: false,
        } as any);

        const customStyle = { backgroundColor: 'red', borderRadius: 8 };
        const { UNSAFE_getByType } = render(<CustomCastButton style={customStyle} />);

        const button = UNSAFE_getByType(TouchableOpacity);

        // Verify the button exists and has props indicating style is passed.
        expect(button).toBeTruthy();
        expect(button.props.style).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    width: 48,
                    height: 48,
                    justifyContent: 'center',
                    alignItems: 'center',
                }),
                customStyle,
            ])
        );
    });

    it('maintains default button dimensions and styling', () => {
        // Mock cast context.
        mockUseCast.mockReturnValue({
            isConnected: false,
        } as any);

        const { UNSAFE_getByType } = render(<CustomCastButton />);

        const button = UNSAFE_getByType(TouchableOpacity);

        // Verify default styling is applied via props.
        expect(button.props.style).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    width: 48,
                    height: 48,
                    justifyContent: 'center',
                    alignItems: 'center',
                }),
            ])
        );
    });

    it('handles connection state changes dynamically', () => {
        // Mock cast context initially not connected.
        mockUseCast.mockReturnValue({
            isConnected: false,
        } as any);

        const { getByTestId, rerender } = render(<CustomCastButton />);

        // Verify disconnected icon initially.
        expect(getByTestId('material-icon')).toHaveTextContent('cast-24-white');

        // Update mock to connected state.
        mockUseCast.mockReturnValue({
            isConnected: true,
        } as any);

        // Re-render component with updated context.
        rerender(<CustomCastButton />);

        // Verify connected icon after state change.
        expect(getByTestId('material-icon')).toHaveTextContent('cast-connected-24-white');
    });

    it('uses default props when none provided', () => {
        // Mock cast context.
        mockUseCast.mockReturnValue({
            isConnected: false,
        } as any);

        const { getByTestId, UNSAFE_getByType } = render(<CustomCastButton />);

        // Verify default tintColor (white) and size (24) are used.
        expect(getByTestId('material-icon')).toHaveTextContent('cast-24-white');

        const button = UNSAFE_getByType(TouchableOpacity);

        // Verify default button dimensions via props.
        expect(button.props.style).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    width: 48,
                    height: 48,
                    justifyContent: 'center',
                    alignItems: 'center',
                }),
            ])
        );
    });

    it('applies activeOpacity to TouchableOpacity', () => {
        // Mock cast context.
        mockUseCast.mockReturnValue({
            isConnected: false,
        } as any);

        const { UNSAFE_getByType } = render(<CustomCastButton />);

        const touchableOpacity = UNSAFE_getByType(TouchableOpacity);

        // Verify activeOpacity is set correctly.
        expect(touchableOpacity.props.activeOpacity).toBe(0.7);
    });

    it('integrates properly with cast context changes', () => {
        // Test that the component properly responds to cast context updates.
        const mockCastContext = { isConnected: false };
        mockUseCast.mockReturnValue(mockCastContext as any);

        const { getByTestId, rerender } = render(<CustomCastButton />);

        // Initially not connected.
        expect(getByTestId('material-icon')).toHaveTextContent('cast-24-white');

        // Simulate cast connection.
        mockCastContext.isConnected = true;
        mockUseCast.mockReturnValue(mockCastContext as any);
        rerender(<CustomCastButton />);

        // Verify icon updates to connected state.
        expect(getByTestId('material-icon')).toHaveTextContent('cast-connected-24-white');

        // Simulate cast disconnection.
        mockCastContext.isConnected = false;
        mockUseCast.mockReturnValue(mockCastContext as any);
        rerender(<CustomCastButton />);

        // Verify icon returns to disconnected state.
        expect(getByTestId('material-icon')).toHaveTextContent('cast-24-white');
    });
});
