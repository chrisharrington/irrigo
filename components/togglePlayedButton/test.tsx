import { ToastProvider } from '@/components/toast';
import { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';
import { TogglePlayedButton } from '.';

// Mock the jellyfin hook
const mockUpdateItem = jest.fn();
const mockToggleItemWatched = jest.fn();

jest.mock('@/contexts/jellyfin', () => ({
    useJellyfin: jest.fn(() => ({
        updateItem: mockUpdateItem,
        toggleItemWatched: mockToggleItemWatched,
    })),
}));

// Mock Expo vector icons
jest.mock('@expo/vector-icons', () => ({
    AntDesign: ({ name, size, color }: any) => {
        const React = require('react');
        const { Text } = require('react-native');
        return React.createElement(Text, { testID: 'check-icon' }, `${name}-${size}-${color}`);
    },
}));

// Mock components
jest.mock('@/components/button', () => ({
    SecondaryButton: ({ children, onPress, isDisabled }: any) => {
        const React = require('react');
        const { TouchableOpacity, Text } = require('react-native');
        return React.createElement(
            TouchableOpacity,
            {
                testID: 'secondary-button',
                onPress: onPress,
                disabled: isDisabled,
            },
            React.createElement(Text, null, children)
        );
    },
}));

jest.mock('@/components/spinner', () => {
    const React = require('react');
    const { Text } = require('react-native');
    return {
        __esModule: true,
        default: ({ size }: any) => React.createElement(Text, { testID: 'spinner' }, `Spinner-${size}`),
    };
});

// Mock react-native-portalize
jest.mock('react-native-portalize', () => ({
    Portal: ({ children }: { children: any }) => {
        const React = require('react');
        return React.createElement('View', { testID: 'portal' }, children);
    },
    Host: ({ children }: { children: any }) => {
        const React = require('react');
        return React.createElement('View', { testID: 'portal-host' }, children);
    },
}));

function TestWrapper({ children }: { children: React.ReactNode }) {
    const { Host } = require('react-native-portalize');
    return (
        <Host>
            <ToastProvider>{children}</ToastProvider>
        </Host>
    );
}

describe('ToggleWatchedButton', () => {
    const mockItem: BaseItemDto = {
        Id: 'test-movie-id',
        Name: 'Test Movie',
        UserData: {
            PlaybackPositionTicks: 0,
        },
    };

    let mockOnToggleComplete: jest.Mock;

    beforeEach(() => {
        jest.clearAllMocks();

        // Get the mocked functions
        const { useJellyfin } = require('@/contexts/jellyfin');
        mockToggleItemWatched.mockResolvedValue(true); // Returns the new watched state
        mockUpdateItem.mockResolvedValue(undefined);
        useJellyfin.mockReturnValue({
            toggleItemWatched: mockToggleItemWatched,
            updateItem: mockUpdateItem,
        });

        mockOnToggleComplete = jest.fn();
    });

    it('renders correctly with check circle icon', () => {
        const { getByTestId } = render(
            <TestWrapper>
                <TogglePlayedButton item={mockItem} />
            </TestWrapper>
        );

        expect(getByTestId('secondary-button')).toBeTruthy();
        expect(getByTestId('check-icon')).toBeTruthy();
    });

    it('shows spinner when toggling', async () => {
        // Make the toggle function hang
        mockToggleItemWatched.mockImplementation(() => new Promise(() => {}));

        const { getByTestId, queryByTestId } = render(
            <TestWrapper>
                <TogglePlayedButton item={mockItem} />
            </TestWrapper>
        );

        // Click the button
        fireEvent.press(getByTestId('secondary-button'));

        // Should show spinner and disable button
        await waitFor(() => {
            expect(queryByTestId('spinner')).toBeTruthy();
        });
    });

    it('calls toggleItemWatched with correct parameters', async () => {
        const { getByTestId } = render(
            <TestWrapper>
                <TogglePlayedButton item={mockItem} onToggleComplete={mockOnToggleComplete} />
            </TestWrapper>
        );

        fireEvent.press(getByTestId('secondary-button'));

        await waitFor(() => {
            expect(mockToggleItemWatched).toHaveBeenCalledWith(mockItem, false);
        });
    });

    it('calls toggleItemWatched with watched=true when item has playback progress', async () => {
        const itemWithProgress: BaseItemDto = {
            ...mockItem,
            UserData: {
                PlaybackPositionTicks: 1000000,
            },
        };

        const { getByTestId } = render(
            <TestWrapper>
                <TogglePlayedButton item={itemWithProgress} onToggleComplete={mockOnToggleComplete} />
            </TestWrapper>
        );

        fireEvent.press(getByTestId('secondary-button'));

        await waitFor(() => {
            expect(mockToggleItemWatched).toHaveBeenCalledWith(itemWithProgress, true);
        });
    });

    it('calls onToggleComplete callback when operation succeeds', async () => {
        const { getByTestId } = render(
            <TestWrapper>
                <TogglePlayedButton item={mockItem} onToggleComplete={mockOnToggleComplete} />
            </TestWrapper>
        );

        fireEvent.press(getByTestId('secondary-button'));

        await waitFor(() => {
            expect(mockOnToggleComplete).toHaveBeenCalled();
        });
    });

    it('handles toggle failure gracefully', async () => {
        mockToggleItemWatched.mockRejectedValue(new Error('Toggle failed'));

        const { getByTestId } = render(
            <TestWrapper>
                <TogglePlayedButton item={mockItem} onToggleComplete={mockOnToggleComplete} />
            </TestWrapper>
        );

        fireEvent.press(getByTestId('secondary-button'));

        await waitFor(() => {
            expect(mockOnToggleComplete).not.toHaveBeenCalled();
        });
    });

    it('does not trigger toggle when already toggling', async () => {
        // Make the first call hang
        mockToggleItemWatched.mockImplementation(() => new Promise(() => {}));

        const { getByTestId } = render(
            <TestWrapper>
                <TogglePlayedButton item={mockItem} />
            </TestWrapper>
        );

        // Click multiple times rapidly
        fireEvent.press(getByTestId('secondary-button'));
        fireEvent.press(getByTestId('secondary-button'));
        fireEvent.press(getByTestId('secondary-button'));

        // Should only be called once
        await waitFor(() => {
            expect(mockToggleItemWatched).toHaveBeenCalledTimes(1);
        });
    });

    it('does not trigger toggle when item is null', async () => {
        const { getByTestId } = render(
            <TestWrapper>
                <TogglePlayedButton item={null as any} />
            </TestWrapper>
        );

        fireEvent.press(getByTestId('secondary-button'));

        // Should not call toggle function
        expect(mockToggleItemWatched).not.toHaveBeenCalled();
    });
});
