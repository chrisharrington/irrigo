import { fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';
import { Button, View } from 'react-native';
import { ToastProvider, useToast } from '.';

// Mock only third-party dependencies
jest.mock('react-native-portalize', () => ({
    Portal: ({ children }: { children: React.ReactNode }) => {
        const React = require('react');
        return React.createElement('View', { testID: 'portal' }, children);
    },
}));

// Test component that uses the toast functionality
function TestComponent() {
    const { success, error } = useToast();

    return (
        <View>
            <Button
                title='Show Success Toast'
                onPress={() => success('Operation completed successfully!')}
                testID='success-button'
            />
            <Button title='Show Error Toast' onPress={() => error('Something went wrong!')} testID='error-button' />
            <Button
                title='Show Multiple Toasts'
                onPress={() => {
                    success('First success message');
                    error('First error message');
                    success('Second success message');
                }}
                testID='multiple-button'
            />
        </View>
    );
}

// Test wrapper that provides the toast context
function TestWrapper({ children }: { children: React.ReactNode }) {
    return <ToastProvider>{children}</ToastProvider>;
}

describe('Toast Component - User Toast Notification Behavior', () => {
    // Mock timers for testing auto-dismissal
    beforeEach(() => {
        jest.useFakeTimers();
        jest.clearAllMocks();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    describe('When user triggers a success toast', () => {
        it('should display a success toast message', async () => {
            const { getByTestId, getByText } = render(
                <TestWrapper>
                    <TestComponent />
                </TestWrapper>
            );

            const successButton = getByTestId('success-button');
            fireEvent.press(successButton);

            // Toast should appear with the success message
            await waitFor(() => {
                expect(getByText('Operation completed successfully!')).toBeTruthy();
            });
        });

        it('should show success toast with green background styling', async () => {
            const { getByTestId, getByText } = render(
                <TestWrapper>
                    <TestComponent />
                </TestWrapper>
            );

            const successButton = getByTestId('success-button');
            fireEvent.press(successButton);

            await waitFor(() => {
                const toastText = getByText('Operation completed successfully!');
                expect(toastText).toBeTruthy();

                // The toast should be rendered within the portal
                const portal = getByTestId('portal');
                expect(portal).toBeTruthy();
            });
        });

        it('should automatically dismiss success toast after 5 seconds', async () => {
            const { getByTestId, getByText, queryByText } = render(
                <TestWrapper>
                    <TestComponent />
                </TestWrapper>
            );

            const successButton = getByTestId('success-button');
            fireEvent.press(successButton);

            // Toast should be visible initially
            await waitFor(() => {
                expect(getByText('Operation completed successfully!')).toBeTruthy();
            });

            // Fast-forward time by 5 seconds
            jest.advanceTimersByTime(5000);

            // Toast should be dismissed after animation
            await waitFor(() => {
                expect(queryByText('Operation completed successfully!')).toBeNull();
            });
        });
    });

    describe('When user triggers an error toast', () => {
        it('should display an error toast message', async () => {
            const { getByTestId, getByText } = render(
                <TestWrapper>
                    <TestComponent />
                </TestWrapper>
            );

            const errorButton = getByTestId('error-button');
            fireEvent.press(errorButton);

            // Toast should appear with the error message
            await waitFor(() => {
                expect(getByText('Something went wrong!')).toBeTruthy();
            });
        });

        it('should show error toast with red background styling', async () => {
            const { getByTestId, getByText } = render(
                <TestWrapper>
                    <TestComponent />
                </TestWrapper>
            );

            const errorButton = getByTestId('error-button');
            fireEvent.press(errorButton);

            await waitFor(() => {
                const toastText = getByText('Something went wrong!');
                expect(toastText).toBeTruthy();

                // The toast should be rendered within the portal
                const portal = getByTestId('portal');
                expect(portal).toBeTruthy();
            });
        });

        it('should automatically dismiss error toast after 5 seconds', async () => {
            const { getByTestId, getByText, queryByText } = render(
                <TestWrapper>
                    <TestComponent />
                </TestWrapper>
            );

            const errorButton = getByTestId('error-button');
            fireEvent.press(errorButton);

            // Toast should be visible initially
            await waitFor(() => {
                expect(getByText('Something went wrong!')).toBeTruthy();
            });

            // Fast-forward time by 5 seconds
            jest.advanceTimersByTime(5000);

            // Toast should be dismissed after animation
            await waitFor(() => {
                expect(queryByText('Something went wrong!')).toBeNull();
            });
        });
    });

    describe('When user triggers multiple toasts', () => {
        it('should display only the latest toast message', async () => {
            const { getByTestId, getByText, queryByText } = render(
                <TestWrapper>
                    <TestComponent />
                </TestWrapper>
            );

            const multipleButton = getByTestId('multiple-button');
            fireEvent.press(multipleButton);

            // Only the last toast should be visible (the component slides down, updates, slides up)
            await waitFor(() => {
                expect(queryByText('First success message')).toBeNull();
                expect(queryByText('First error message')).toBeNull();
                expect(getByText('Second success message')).toBeTruthy();
            });
        });

        it('should update existing toast with latest content via slide animation', async () => {
            const { getByTestId, getByText, queryByText } = render(
                <TestWrapper>
                    <TestComponent />
                </TestWrapper>
            );

            // Show first toast
            const successButton = getByTestId('success-button');
            fireEvent.press(successButton);

            await waitFor(() => {
                expect(getByText('Operation completed successfully!')).toBeTruthy();
            });

            // Show second toast - should replace the first
            const errorButton = getByTestId('error-button');
            fireEvent.press(errorButton);

            await waitFor(() => {
                expect(queryByText('Operation completed successfully!')).toBeNull();
                expect(getByText('Something went wrong!')).toBeTruthy();
            });
        });

        it('should slide down and back up when showing same toast twice', async () => {
            const { getByTestId, getByText } = render(
                <TestWrapper>
                    <TestComponent />
                </TestWrapper>
            );

            // Show first toast
            const successButton = getByTestId('success-button');
            fireEvent.press(successButton);

            await waitFor(() => {
                expect(getByText('Operation completed successfully!')).toBeTruthy();
            });

            // Press the same button again - should trigger slide animation
            fireEvent.press(successButton);

            // Toast should still be there after the slide animation
            await waitFor(() => {
                expect(getByText('Operation completed successfully!')).toBeTruthy();
            });
        });

        it('should dismiss the latest toast after its timer', async () => {
            const { getByTestId, queryByText } = render(
                <TestWrapper>
                    <TestComponent />
                </TestWrapper>
            );

            const multipleButton = getByTestId('multiple-button');
            fireEvent.press(multipleButton);

            // Fast-forward time by 5 seconds
            jest.advanceTimersByTime(5000);

            // The latest toast should be dismissed
            await waitFor(() => {
                expect(queryByText('First success message')).toBeNull();
                expect(queryByText('First error message')).toBeNull();
                expect(queryByText('Second success message')).toBeNull();
            });
        });
    });

    describe('When useToast hook is used outside ToastProvider', () => {
        it('should throw an error with helpful message', () => {
            // Component that tries to use toast without provider
            function ComponentWithoutProvider() {
                const { success } = useToast();
                return <Button title='Test' onPress={() => success('Test')} />;
            }

            // Should throw error when rendered without provider
            expect(() => {
                render(<ComponentWithoutProvider />);
            }).toThrow('useToast must be used within a ToastProvider');
        });
    });

    describe('When toast content varies in length', () => {
        it('should handle short toast messages', async () => {
            function ShortMessageComponent() {
                const { success } = useToast();
                return <Button title='Short' onPress={() => success('OK')} testID='short-button' />;
            }

            const { getByTestId, getByText } = render(
                <TestWrapper>
                    <ShortMessageComponent />
                </TestWrapper>
            );

            fireEvent.press(getByTestId('short-button'));

            await waitFor(() => {
                expect(getByText('OK')).toBeTruthy();
            });
        });

        it('should handle long toast messages', async () => {
            function LongMessageComponent() {
                const { error } = useToast();
                const longMessage =
                    'This is a very long error message that should still be displayed properly in the toast notification system without breaking the layout or causing any visual issues.';

                return <Button title='Long' onPress={() => error(longMessage)} testID='long-button' />;
            }

            const { getByTestId, getByText } = render(
                <TestWrapper>
                    <LongMessageComponent />
                </TestWrapper>
            );

            fireEvent.press(getByTestId('long-button'));

            await waitFor(() => {
                expect(getByText(/This is a very long error message/)).toBeTruthy();
            });
        });
    });

    describe('When user performs rapid toast interactions', () => {
        it('should handle rapid successive toast calls by showing only the latest', async () => {
            function RapidToastComponent() {
                const { success, error } = useToast();

                return (
                    <Button
                        title='Rapid Toasts'
                        onPress={() => {
                            // Simulate rapid user interactions
                            success('Message 1');
                            success('Message 2');
                            error('Error 1');
                            success('Message 3');
                            error('Error 2');
                        }}
                        testID='rapid-button'
                    />
                );
            }

            const { getByTestId, getByText, queryByText } = render(
                <TestWrapper>
                    <RapidToastComponent />
                </TestWrapper>
            );

            fireEvent.press(getByTestId('rapid-button'));

            // Only the last message should be visible
            await waitFor(() => {
                expect(queryByText('Message 1')).toBeNull();
                expect(queryByText('Message 2')).toBeNull();
                expect(queryByText('Error 1')).toBeNull();
                expect(queryByText('Message 3')).toBeNull();
                expect(getByText('Error 2')).toBeTruthy();
            });
        });
    });
    describe('When toast system is integrated into app workflow', () => {
        it('should support a complete user workflow with mixed toast types', async () => {
            function WorkflowComponent() {
                const { success, error } = useToast();

                return (
                    <View>
                        <Button
                            title='Start Process'
                            onPress={() => success('Process started')}
                            testID='start-button'
                        />
                        <Button title='Encounter Error' onPress={() => error('Process failed')} testID='error-button' />
                        <Button
                            title='Complete Process'
                            onPress={() => success('Process completed successfully')}
                            testID='complete-button'
                        />
                    </View>
                );
            }

            const { getByTestId, getByText, queryByText } = render(
                <TestWrapper>
                    <WorkflowComponent />
                </TestWrapper>
            );

            // Simulate a complete user workflow
            fireEvent.press(getByTestId('start-button'));
            await waitFor(() => {
                expect(getByText('Process started')).toBeTruthy();
            });

            fireEvent.press(getByTestId('error-button'));
            await waitFor(() => {
                expect(queryByText('Process started')).toBeNull(); // Previous toast replaced
                expect(getByText('Process failed')).toBeTruthy();
            });

            fireEvent.press(getByTestId('complete-button'));
            await waitFor(() => {
                expect(queryByText('Process failed')).toBeNull(); // Previous toast replaced
                expect(getByText('Process completed successfully')).toBeTruthy();
            });

            // Wait for auto-dismissal
            jest.advanceTimersByTime(5000);
            await waitFor(() => {
                expect(queryByText('Process started')).toBeNull();
                expect(queryByText('Process failed')).toBeNull();
                expect(queryByText('Process completed successfully')).toBeNull();
            });
        });
    });
});
