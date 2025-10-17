import { useCast } from '@/contexts/cast';
import { LabelValue } from '@/models';
import { fireEvent, render } from '@testing-library/react-native';
import React from 'react';
import { DeviceSelector } from '.';

/**
 * Test suite for DeviceSelector component - Cast Device Selection Interface.
 * This file tests the functionality of the device selector including
 * device list display, selection handling, and visibility management.
 */

// Mock the cast context.
jest.mock('@/contexts/cast', () => ({
    useCast: jest.fn(),
}));

// Mock the Selector component with realistic behavior.
jest.mock('@/components/selector', () => ({
    Selector: ({ visible, onClose, options, selectedValue, onSelectValue, title, icon }: any) => {
        const React = require('react');
        const { View, Text, TouchableOpacity, ScrollView } = require('react-native');

        if (!visible) return null;

        return (
            <View testID='device-selector-modal'>
                <View testID='selector-header'>
                    <Text testID={`selector-icon-${icon}`}>{icon}</Text>
                    <Text testID='selector-title'>{title}</Text>
                    <TouchableOpacity testID='close-button' onPress={onClose}>
                        <Text testID='close-icon'>close</Text>
                    </TouchableOpacity>
                </View>
                <ScrollView testID='selector-content'>
                    {options.map((option: LabelValue) => (
                        <TouchableOpacity
                            key={option.value || 'local-device'}
                            testID={`device-option-${option.value || 'local-device'}`}
                            onPress={() => onSelectValue(option.value)}
                        >
                            <Text testID={`device-label-${option.value || 'local-device'}`}>{option.label}</Text>
                            {selectedValue === option.value && (
                                <Text testID={`check-icon-${option.value || 'local-device'}`}>check</Text>
                            )}
                        </TouchableOpacity>
                    ))}
                </ScrollView>
            </View>
        );
    },
}));

describe('DeviceSelector', () => {
    const mockUseCast = useCast as jest.MockedFunction<typeof useCast>;
    const mockOnClose = jest.fn();
    const mockOnDeviceSelect = jest.fn();

    const createMockDevice = (value: string | null, label: string): LabelValue => ({
        value,
        label,
    });

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('renders device selector when visible', () => {
        // Mock cast context with devices.
        const mockDevices = [
            createMockDevice('device-1', 'Living Room TV'),
            createMockDevice('device-2', 'Bedroom Chromecast'),
            createMockDevice(null, 'This Device'),
        ];

        mockUseCast.mockReturnValue({
            devices: mockDevices,
        } as any);

        const { getByTestId } = render(
            <DeviceSelector
                isVisible={true}
                selectedDeviceId='device-1'
                onClose={mockOnClose}
                onDeviceSelect={mockOnDeviceSelect}
            />
        );

        // Verify the selector modal is rendered.
        expect(getByTestId('device-selector-modal')).toBeTruthy();
        expect(getByTestId('selector-title')).toHaveTextContent('Device');
        expect(getByTestId('selector-icon-cast')).toHaveTextContent('cast');
    });

    it('does not render when not visible', () => {
        // Mock cast context with devices.
        const mockDevices = [createMockDevice('device-1', 'Living Room TV')];

        mockUseCast.mockReturnValue({
            devices: mockDevices,
        } as any);

        const { queryByTestId } = render(
            <DeviceSelector
                isVisible={false}
                selectedDeviceId='device-1'
                onClose={mockOnClose}
                onDeviceSelect={mockOnDeviceSelect}
            />
        );

        // Verify the selector is not rendered when not visible.
        expect(queryByTestId('device-selector-modal')).toBeFalsy();
    });

    it('displays available devices from cast context', () => {
        // Mock cast context with multiple devices.
        const mockDevices = [
            createMockDevice('device-1', 'Living Room TV'),
            createMockDevice('device-2', 'Bedroom Chromecast'),
            createMockDevice('device-3', 'Kitchen Speaker'),
            createMockDevice(null, 'This Device'),
        ];

        mockUseCast.mockReturnValue({
            devices: mockDevices,
        } as any);

        const { getByTestId } = render(
            <DeviceSelector
                isVisible={true}
                selectedDeviceId='device-2'
                onClose={mockOnClose}
                onDeviceSelect={mockOnDeviceSelect}
            />
        );

        // Verify all devices are displayed.
        expect(getByTestId('device-label-device-1')).toHaveTextContent('Living Room TV');
        expect(getByTestId('device-label-device-2')).toHaveTextContent('Bedroom Chromecast');
        expect(getByTestId('device-label-device-3')).toHaveTextContent('Kitchen Speaker');
        expect(getByTestId('device-label-local-device')).toHaveTextContent('This Device');
    });

    it('shows selected device correctly', () => {
        // Mock cast context with devices.
        const mockDevices = [
            createMockDevice('device-1', 'Living Room TV'),
            createMockDevice('device-2', 'Bedroom Chromecast'),
        ];

        mockUseCast.mockReturnValue({
            devices: mockDevices,
        } as any);

        const { getByTestId, queryByTestId } = render(
            <DeviceSelector
                isVisible={true}
                selectedDeviceId='device-1'
                onClose={mockOnClose}
                onDeviceSelect={mockOnDeviceSelect}
            />
        );

        // Verify the selected device has a check icon.
        expect(getByTestId('check-icon-device-1')).toHaveTextContent('check');
        expect(queryByTestId('check-icon-device-2')).toBeFalsy();
    });

    it('handles device selection', () => {
        // Mock cast context with devices.
        const mockDevices = [
            createMockDevice('device-1', 'Living Room TV'),
            createMockDevice('device-2', 'Bedroom Chromecast'),
        ];

        mockUseCast.mockReturnValue({
            devices: mockDevices,
        } as any);

        const { getByTestId } = render(
            <DeviceSelector
                isVisible={true}
                selectedDeviceId='device-1'
                onClose={mockOnClose}
                onDeviceSelect={mockOnDeviceSelect}
            />
        );

        // Simulate device selection.
        fireEvent.press(getByTestId('device-option-device-2'));

        // Verify the selection callback was called with correct device ID.
        expect(mockOnDeviceSelect).toHaveBeenCalledTimes(1);
        expect(mockOnDeviceSelect).toHaveBeenCalledWith('device-2');
    });

    it('handles "This Device" selection (null value)', () => {
        // Mock cast context with devices including "This Device".
        const mockDevices = [createMockDevice('device-1', 'Living Room TV'), createMockDevice(null, 'This Device')];

        mockUseCast.mockReturnValue({
            devices: mockDevices,
        } as any);

        const { getByTestId } = render(
            <DeviceSelector
                isVisible={true}
                selectedDeviceId='device-1'
                onClose={mockOnClose}
                onDeviceSelect={mockOnDeviceSelect}
            />
        );

        // Simulate "This Device" selection.
        fireEvent.press(getByTestId('device-option-local-device'));

        // Verify the selection callback was called with null (local device).
        expect(mockOnDeviceSelect).toHaveBeenCalledTimes(1);
        expect(mockOnDeviceSelect).toHaveBeenCalledWith(null);
    });

    it('handles close action', () => {
        // Mock cast context with devices.
        const mockDevices = [createMockDevice('device-1', 'Living Room TV')];

        mockUseCast.mockReturnValue({
            devices: mockDevices,
        } as any);

        const { getByTestId } = render(
            <DeviceSelector
                isVisible={true}
                selectedDeviceId='device-1'
                onClose={mockOnClose}
                onDeviceSelect={mockOnDeviceSelect}
            />
        );

        // Simulate close button press.
        fireEvent.press(getByTestId('close-button'));

        // Verify the close callback was called.
        expect(mockOnClose).toHaveBeenCalledTimes(1);
    });

    it('displays empty list when no devices available', () => {
        // Mock cast context with no devices.
        mockUseCast.mockReturnValue({
            devices: [],
        } as any);

        const { getByTestId, queryByTestId } = render(
            <DeviceSelector
                isVisible={true}
                selectedDeviceId='device-1'
                onClose={mockOnClose}
                onDeviceSelect={mockOnDeviceSelect}
            />
        );

        // Verify the selector is rendered but contains no device options.
        expect(getByTestId('device-selector-modal')).toBeTruthy();
        expect(getByTestId('selector-content')).toBeTruthy();
        expect(queryByTestId('device-option-device-1')).toBeFalsy();
        expect(queryByTestId('device-option-local-device')).toBeFalsy();
    });

    it('handles selection when selectedDeviceId is empty string', () => {
        // Mock cast context with devices.
        const mockDevices = [createMockDevice('device-1', 'Living Room TV'), createMockDevice(null, 'This Device')];

        mockUseCast.mockReturnValue({
            devices: mockDevices,
        } as any);

        const { getByTestId, queryByTestId } = render(
            <DeviceSelector
                isVisible={true}
                selectedDeviceId='' // Empty string to test no selection
                onClose={mockOnClose}
                onDeviceSelect={mockOnDeviceSelect}
            />
        );

        // Verify devices are displayed but none are selected.
        expect(getByTestId('device-label-device-1')).toHaveTextContent('Living Room TV');
        expect(getByTestId('device-label-local-device')).toHaveTextContent('This Device');

        // Verify no check icons are displayed (no device is selected).
        expect(queryByTestId('check-icon-device-1')).toBeFalsy();
        expect(queryByTestId('check-icon-local-device')).toBeFalsy();
    });

    it('passes correct props to Selector component', () => {
        // Mock cast context with devices.
        const mockDevices = [
            createMockDevice('device-1', 'Living Room TV'),
            createMockDevice('device-2', 'Bedroom Chromecast'),
        ];

        mockUseCast.mockReturnValue({
            devices: mockDevices,
        } as any);

        const { getByTestId } = render(
            <DeviceSelector
                isVisible={true}
                selectedDeviceId='device-1'
                onClose={mockOnClose}
                onDeviceSelect={mockOnDeviceSelect}
            />
        );

        // Verify correct props are passed to Selector.
        expect(getByTestId('selector-title')).toHaveTextContent('Device');
        expect(getByTestId('selector-icon-cast')).toHaveTextContent('cast');

        // Verify devices are passed as options.
        expect(getByTestId('device-label-device-1')).toHaveTextContent('Living Room TV');
        expect(getByTestId('device-label-device-2')).toHaveTextContent('Bedroom Chromecast');
    });

    it('updates when cast context devices change', () => {
        // Mock cast context with initial devices.
        const initialDevices = [createMockDevice('device-1', 'Living Room TV')];

        mockUseCast.mockReturnValue({
            devices: initialDevices,
        } as any);

        const { getByTestId, queryByTestId, rerender } = render(
            <DeviceSelector
                isVisible={true}
                selectedDeviceId='device-1'
                onClose={mockOnClose}
                onDeviceSelect={mockOnDeviceSelect}
            />
        );

        // Verify initial state.
        expect(getByTestId('device-label-device-1')).toHaveTextContent('Living Room TV');
        expect(queryByTestId('device-label-device-2')).toBeFalsy();

        // Update cast context with new devices.
        const updatedDevices = [
            createMockDevice('device-1', 'Living Room TV'),
            createMockDevice('device-2', 'New Chromecast'),
        ];

        mockUseCast.mockReturnValue({
            devices: updatedDevices,
        } as any);

        // Re-render component with updated context.
        rerender(
            <DeviceSelector
                isVisible={true}
                selectedDeviceId='device-1'
                onClose={mockOnClose}
                onDeviceSelect={mockOnDeviceSelect}
            />
        );

        // Verify updated devices are displayed.
        expect(getByTestId('device-label-device-1')).toHaveTextContent('Living Room TV');
        expect(getByTestId('device-label-device-2')).toHaveTextContent('New Chromecast');
    });
});
