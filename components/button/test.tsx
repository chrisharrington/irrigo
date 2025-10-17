import { fireEvent, render } from '@testing-library/react-native';
import React from 'react';
import { Text, View } from 'react-native';
import { PrimaryButton, SecondaryButton } from '.';

describe('PrimaryButton', () => {
    describe('Text rendering behavior', () => {
        it('should render text when text prop is provided', () => {
            // Render PrimaryButton with text prop.
            const { getByText } = render(<PrimaryButton text='Click Me' />);

            // Verify the text is displayed correctly.
            expect(getByText('Click Me')).toBeTruthy();
        });

        it('should render children when no text prop is provided', () => {
            // Render PrimaryButton with children only.
            const { getByTestId } = render(
                <PrimaryButton>
                    <View testID='custom-content'>
                        <Text>Custom Content</Text>
                    </View>
                </PrimaryButton>
            );

            // Verify children are rendered when no text prop is provided.
            expect(getByTestId('custom-content')).toBeTruthy();
        });

        it('should prioritize text over children when both are provided', () => {
            // Render PrimaryButton with both text and children.
            const { getByText, queryByTestId } = render(
                <PrimaryButton text='Text Priority'>
                    <View testID='ignored-children'>
                        <Text>This should be ignored</Text>
                    </View>
                </PrimaryButton>
            );

            // Verify text is displayed and children are ignored.
            expect(getByText('Text Priority')).toBeTruthy();
            expect(queryByTestId('ignored-children')).toBeNull();
        });
    });

    describe('Press interaction behavior', () => {
        it('should call onPress when button is pressed and not disabled', () => {
            const mockOnPress = jest.fn();

            // Render PrimaryButton with onPress handler.
            const { getByText } = render(<PrimaryButton text='Clickable' onPress={mockOnPress} />);

            const button = getByText('Clickable').parent;

            // Verify button can be pressed.
            fireEvent.press(button!);
            expect(mockOnPress).toHaveBeenCalledTimes(1);

            // Verify multiple presses work.
            fireEvent.press(button!);
            expect(mockOnPress).toHaveBeenCalledTimes(2);
        });

        it('should not call onPress when button is disabled', () => {
            const mockOnPress = jest.fn();

            // Render disabled PrimaryButton.
            const { getByText } = render(<PrimaryButton text='Disabled' onPress={mockOnPress} isDisabled={true} />);

            const button = getByText('Disabled').parent;

            // Verify onPress is not called when button is pressed while disabled.
            fireEvent.press(button!);
            expect(mockOnPress).not.toHaveBeenCalled();
        });

        it('should handle missing onPress gracefully', () => {
            // Render PrimaryButton without onPress handler.
            const { getByText } = render(<PrimaryButton text='No Handler' />);

            const button = getByText('No Handler').parent;

            // Verify pressing button doesn't cause errors.
            expect(() => fireEvent.press(button!)).not.toThrow();
        });
    });

    describe('Disabled state behavior', () => {
        it('should prevent onPress when button is disabled', () => {
            const mockOnPress = jest.fn();

            // Render disabled PrimaryButton.
            const { getByText } = render(<PrimaryButton text='Disabled' isDisabled={true} onPress={mockOnPress} />);

            // Verify onPress is not called when button is pressed while disabled.
            fireEvent.press(getByText('Disabled'));
            expect(mockOnPress).not.toHaveBeenCalled();
        });

        it('should allow onPress when button is enabled', () => {
            const mockOnPress = jest.fn();

            // Render enabled PrimaryButton.
            const { getByText } = render(<PrimaryButton text='Enabled' isDisabled={false} onPress={mockOnPress} />);

            // Verify onPress is called when button is pressed while enabled.
            fireEvent.press(getByText('Enabled'));
            expect(mockOnPress).toHaveBeenCalledTimes(1);
        });

        it('should allow onPress when isDisabled is not provided', () => {
            const mockOnPress = jest.fn();

            // Render PrimaryButton without isDisabled prop.
            const { getByText } = render(<PrimaryButton text='Default' onPress={mockOnPress} />);

            // Verify onPress is called when button is pressed (default enabled state).
            fireEvent.press(getByText('Default'));
            expect(mockOnPress).toHaveBeenCalledTimes(1);
        });
    });

    describe('Component rendering validation', () => {
        it('should render successfully with no props', () => {
            // Render PrimaryButton with no props.
            expect(() => render(<PrimaryButton />)).not.toThrow();
        });

        it('should render complex children correctly', () => {
            const CustomIcon = () => <Text testID='icon'>🚀</Text>;

            // Render PrimaryButton with complex children.
            const { getByTestId, getByText } = render(
                <PrimaryButton>
                    <View testID='complex-content'>
                        <CustomIcon />
                        <Text>Launch App</Text>
                    </View>
                </PrimaryButton>
            );

            // Verify all child components are rendered.
            expect(getByTestId('complex-content')).toBeTruthy();
            expect(getByTestId('icon')).toBeTruthy();
            expect(getByText('Launch App')).toBeTruthy();
        });
    });
});

describe('SecondaryButton', () => {
    describe('Text rendering behavior', () => {
        it('should render text when text prop is provided', () => {
            // Render SecondaryButton with text prop.
            const { getByText } = render(<SecondaryButton text='Secondary Action' />);

            // Verify the text is displayed correctly.
            expect(getByText('Secondary Action')).toBeTruthy();
        });

        it('should render children when no text prop is provided', () => {
            // Render SecondaryButton with children only.
            const { getByTestId } = render(
                <SecondaryButton>
                    <View testID='secondary-content'>
                        <Text>Secondary Content</Text>
                    </View>
                </SecondaryButton>
            );

            // Verify children are rendered when no text prop is provided.
            expect(getByTestId('secondary-content')).toBeTruthy();
        });

        it('should prioritize text over children when both are provided', () => {
            // Render SecondaryButton with both text and children.
            const { getByText, queryByTestId } = render(
                <SecondaryButton text='Text Wins'>
                    <View testID='ignored-secondary'>
                        <Text>This should be ignored</Text>
                    </View>
                </SecondaryButton>
            );

            // Verify text is displayed and children are ignored.
            expect(getByText('Text Wins')).toBeTruthy();
            expect(queryByTestId('ignored-secondary')).toBeNull();
        });
    });

    describe('Press interaction behavior', () => {
        it('should call onPress when button is pressed and not disabled', () => {
            const mockOnPress = jest.fn();

            // Render SecondaryButton with onPress handler.
            const { getByText } = render(<SecondaryButton text='Clickable' onPress={mockOnPress} />);

            const button = getByText('Clickable').parent;

            // Verify button can be pressed.
            fireEvent.press(button!);
            expect(mockOnPress).toHaveBeenCalledTimes(1);

            // Verify multiple presses work.
            fireEvent.press(button!);
            expect(mockOnPress).toHaveBeenCalledTimes(2);
        });

        it('should not call onPress when button is disabled', () => {
            const mockOnPress = jest.fn();

            // Render disabled SecondaryButton.
            const { getByText } = render(<SecondaryButton text='Disabled' onPress={mockOnPress} isDisabled={true} />);

            const button = getByText('Disabled').parent;

            // Verify onPress is not called when button is pressed while disabled.
            fireEvent.press(button!);
            expect(mockOnPress).not.toHaveBeenCalled();
        });
    });

    describe('Disabled state behavior', () => {
        it('should prevent onPress when button is disabled', () => {
            const mockOnPress = jest.fn();

            // Render disabled SecondaryButton.
            const { getByText } = render(<SecondaryButton text='Disabled' isDisabled={true} onPress={mockOnPress} />);

            // Verify onPress is not called when button is pressed while disabled.
            fireEvent.press(getByText('Disabled'));
            expect(mockOnPress).not.toHaveBeenCalled();
        });

        it('should allow onPress when button is enabled', () => {
            const mockOnPress = jest.fn();

            // Render enabled SecondaryButton.
            const { getByText } = render(<SecondaryButton text='Enabled' isDisabled={false} onPress={mockOnPress} />);

            // Verify onPress is called when button is pressed while enabled.
            fireEvent.press(getByText('Enabled'));
            expect(mockOnPress).toHaveBeenCalledTimes(1);
        });
    });

    describe('Component rendering validation', () => {
        it('should render successfully with no props', () => {
            // Render SecondaryButton with no props.
            expect(() => render(<SecondaryButton />)).not.toThrow();
        });
    });
});

describe('Button Component Consistency', () => {
    describe('Cross-component behavior validation', () => {
        it('should render both button types with consistent interface', () => {
            const primaryOnPress = jest.fn();
            const secondaryOnPress = jest.fn();

            // Render both button types with identical props.
            const primaryResult = render(<PrimaryButton text='Test' onPress={primaryOnPress} />);
            const secondaryResult = render(<SecondaryButton text='Test' onPress={secondaryOnPress} />);

            // Verify both buttons render text correctly.
            expect(primaryResult.getByText('Test')).toBeTruthy();
            expect(secondaryResult.getByText('Test')).toBeTruthy();

            // Verify both components accept the same prop interface.
            expect(() =>
                render(<PrimaryButton text='Interface Test' onPress={jest.fn()} isDisabled={false} />)
            ).not.toThrow();
            expect(() =>
                render(<SecondaryButton text='Interface Test' onPress={jest.fn()} isDisabled={false} />)
            ).not.toThrow();
        });

        it('should handle disabled state consistently between button types', () => {
            const primaryOnPress = jest.fn();
            const secondaryOnPress = jest.fn();

            // Render both button types in disabled state.
            const primaryResult = render(<PrimaryButton text='Disabled' onPress={primaryOnPress} isDisabled={true} />);
            const secondaryResult = render(
                <SecondaryButton text='Disabled' onPress={secondaryOnPress} isDisabled={true} />
            );

            // Verify neither button triggers onPress when disabled by pressing the text.
            fireEvent.press(primaryResult.getByText('Disabled'));
            fireEvent.press(secondaryResult.getByText('Disabled'));

            expect(primaryOnPress).not.toHaveBeenCalled();
            expect(secondaryOnPress).not.toHaveBeenCalled();
        });

        it('should handle children rendering consistently between button types', () => {
            // Render both button types with children.
            const primaryResult = render(
                <PrimaryButton>
                    <Text testID='primary-child'>Primary Child</Text>
                </PrimaryButton>
            );
            const secondaryResult = render(
                <SecondaryButton>
                    <Text testID='secondary-child'>Secondary Child</Text>
                </SecondaryButton>
            );

            // Verify both buttons render children when no text prop is provided.
            expect(primaryResult.getByTestId('primary-child')).toBeTruthy();
            expect(secondaryResult.getByTestId('secondary-child')).toBeTruthy();
        });
    });

    describe('Props interface validation', () => {
        it('should accept all valid prop combinations for PrimaryButton', () => {
            const mockOnPress = jest.fn();

            // Test all possible prop combinations.
            expect(() => render(<PrimaryButton />)).not.toThrow();
            expect(() => render(<PrimaryButton text='Text Only' />)).not.toThrow();
            expect(() => render(<PrimaryButton onPress={mockOnPress} />)).not.toThrow();
            expect(() => render(<PrimaryButton isDisabled={true} />)).not.toThrow();
            expect(() =>
                render(<PrimaryButton text='Complete' onPress={mockOnPress} isDisabled={false} />)
            ).not.toThrow();
        });

        it('should accept all valid prop combinations for SecondaryButton', () => {
            const mockOnPress = jest.fn();

            // Test all possible prop combinations.
            expect(() => render(<SecondaryButton />)).not.toThrow();
            expect(() => render(<SecondaryButton text='Text Only' />)).not.toThrow();
            expect(() => render(<SecondaryButton onPress={mockOnPress} />)).not.toThrow();
            expect(() => render(<SecondaryButton isDisabled={true} />)).not.toThrow();
            expect(() =>
                render(<SecondaryButton text='Complete' onPress={mockOnPress} isDisabled={false} />)
            ).not.toThrow();
        });
    });
});
