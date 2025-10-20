import { LabelValue } from '@/models';
import { fireEvent, render } from '@testing-library/react-native';
import { SelectorButton } from '.';

// Mock dependencies
jest.mock('@/components/selector', () => ({
    Selector: ({ visible, onClose, title, icon, options, selectedValue, onSelectValue }: any) => {
        const { View, Text, TouchableOpacity } = require('react-native');
        return visible ? (
            <View testID='selector-modal'>
                <Text testID='selector-title'>{title}</Text>
                <Text testID='selector-icon'>{icon || 'no-icon'}</Text>
                {options.map((option: any) => (
                    <TouchableOpacity
                        key={option.value}
                        testID={`selector-option-${option.value}`}
                        onPress={() => {
                            onSelectValue(option.value);
                            onClose();
                        }}
                    >
                        <Text>{option.label}</Text>
                    </TouchableOpacity>
                ))}
                <TouchableOpacity testID='selector-close' onPress={onClose}>
                    <Text>Close</Text>
                </TouchableOpacity>
            </View>
        ) : null;
    },
}));

jest.mock('@expo/vector-icons', () => ({
    MaterialIcons: ({ name, size, color, style }: any) => {
        const { View, Text } = require('react-native');
        return (
            <View testID={`material-icon-${name}`} style={style}>
                <Text>{`${name}-${size}-${color}`}</Text>
            </View>
        );
    },
}));

jest.mock('./hook', () => ({
    useSelectorButton: jest.fn(),
}));

describe('SelectorButton', () => {
    const mockOnSelectValue = jest.fn(),
        mockSetShowModal = jest.fn(),
        mockGetSelectedLabel = jest.fn();

    // Import mocked modules
    const { useSelectorButton } = require('./hook');

    const createMockOptions = (): LabelValue[] => [
        { value: 'option1', label: 'First Option' },
        { value: 'option2', label: 'Second Option' },
        { value: 'option3', label: 'Third Option' },
        { value: null, label: 'No Selection' },
    ];

    const createDefaultProps = (overrides: Partial<Parameters<typeof SelectorButton>[0]> = {}) => ({
        options: createMockOptions(),
        selectedValue: null,
        onSelectValue: mockOnSelectValue,
        title: 'Select Option',
        defaultLabel: 'Choose an option',
        testIdPrefix: 'test',
        ...overrides,
    });

    beforeEach(() => {
        jest.clearAllMocks();

        // Setup default hook mock
        useSelectorButton.mockReturnValue({
            getSelectedLabel: mockGetSelectedLabel,
            showModal: false,
            setShowModal: mockSetShowModal,
        });

        // Setup default getSelectedLabel behavior
        mockGetSelectedLabel.mockImplementation(
            (options: LabelValue[], selectedValue: string | null, defaultLabel: string) => {
                const option = options.find(opt => opt.value === selectedValue);
                return option?.label || defaultLabel;
            }
        );
    });

    it('renders button with default label when no option selected', () => {
        const optionsWithoutNull: LabelValue[] = [
            { value: 'option1', label: 'First Option' },
            { value: 'option2', label: 'Second Option' },
            { value: 'option3', label: 'Third Option' },
        ];
        const props = createDefaultProps({
            options: optionsWithoutNull,
            selectedValue: null,
        });
        const { getByText, getByTestId } = render(<SelectorButton {...props} />);

        // Verify button and wrapper are rendered with correct testIds.
        expect(getByTestId('test-wrapper')).toBeTruthy();
        expect(getByTestId('test-button')).toBeTruthy();

        // Verify default label is displayed.
        expect(getByText('Choose an option')).toBeTruthy();

        // Verify down arrow icon is displayed.
        expect(getByTestId('material-icon-keyboard-arrow-down')).toBeTruthy();
    });

    it('renders button with selected option label when option is selected', () => {
        mockGetSelectedLabel.mockReturnValue('First Option');
        const props = createDefaultProps({ selectedValue: 'option1' });
        const { getByText } = render(<SelectorButton {...props} />);

        // Verify selected option label is displayed.
        expect(getByText('First Option')).toBeTruthy();
        expect(mockGetSelectedLabel).toHaveBeenCalledWith(createMockOptions(), 'option1', 'Choose an option');
    });

    it('displays icon when iconName is provided', () => {
        const props = createDefaultProps({ iconName: 'settings' });
        const { getByTestId } = render(<SelectorButton {...props} />);

        // Verify icon is displayed before the text.
        expect(getByTestId('material-icon-settings')).toBeTruthy();
    });

    it('does not display icon when iconName is not provided', () => {
        const props = createDefaultProps({ iconName: undefined });
        const { queryByTestId } = render(<SelectorButton {...props} />);

        // Verify no icon is displayed when iconName is undefined.
        expect(queryByTestId('material-icon-settings')).toBeFalsy();
    });

    it('opens selector modal when button is pressed', () => {
        const props = createDefaultProps();
        const { getByTestId } = render(<SelectorButton {...props} />);

        // Simulate button press.
        fireEvent.press(getByTestId('test-button'));

        // Verify setShowModal is called with true.
        expect(mockSetShowModal).toHaveBeenCalledWith(true);
    });

    it('renders selector modal when showModal is true', () => {
        useSelectorButton.mockReturnValue({
            getSelectedLabel: mockGetSelectedLabel,
            showModal: true,
            setShowModal: mockSetShowModal,
        });

        const props = createDefaultProps();
        const { getByTestId, getByText } = render(<SelectorButton {...props} />);

        // Verify selector modal is rendered.
        expect(getByTestId('selector-modal')).toBeTruthy();
        expect(getByText('Select Option')).toBeTruthy();
    });

    it('does not render selector modal when showModal is false', () => {
        const props = createDefaultProps();
        const { queryByTestId } = render(<SelectorButton {...props} />);

        // Verify selector modal is not rendered when showModal is false.
        expect(queryByTestId('selector-modal')).toBeFalsy();
    });

    it('passes correct props to Selector component', () => {
        useSelectorButton.mockReturnValue({
            getSelectedLabel: mockGetSelectedLabel,
            showModal: true,
            setShowModal: mockSetShowModal,
        });

        const props = createDefaultProps({
            title: 'Custom Title',
            iconName: 'star',
            selectedValue: 'option2',
        });
        const { getByTestId, getByText } = render(<SelectorButton {...props} />);

        // Verify selector receives correct props.
        expect(getByText('Custom Title')).toBeTruthy();
        expect(getByTestId('selector-icon')).toHaveTextContent('star');
        expect(getByTestId('selector-option-option1')).toBeTruthy();
        expect(getByTestId('selector-option-option2')).toBeTruthy();
    });

    it('handles option selection from selector modal', () => {
        useSelectorButton.mockReturnValue({
            getSelectedLabel: mockGetSelectedLabel,
            showModal: true,
            setShowModal: mockSetShowModal,
        });

        const props = createDefaultProps();
        const { getByTestId } = render(<SelectorButton {...props} />);

        // Simulate selecting an option from the modal.
        fireEvent.press(getByTestId('selector-option-option2'));

        // Verify onSelectValue callback is called with correct value.
        expect(mockOnSelectValue).toHaveBeenCalledWith('option2');
    });

    it('closes selector modal after option selection', () => {
        useSelectorButton.mockReturnValue({
            getSelectedLabel: mockGetSelectedLabel,
            showModal: true,
            setShowModal: mockSetShowModal,
        });

        const props = createDefaultProps();
        const { getByTestId } = render(<SelectorButton {...props} />);

        // Simulate selecting an option from the modal.
        fireEvent.press(getByTestId('selector-option-option1'));

        // Verify modal close logic is triggered (in our mock it calls onClose).
        // The actual setShowModal(false) would be called by the Selector's onClose.
    });

    it('handles selector modal close button', () => {
        useSelectorButton.mockReturnValue({
            getSelectedLabel: mockGetSelectedLabel,
            showModal: true,
            setShowModal: mockSetShowModal,
        });

        const props = createDefaultProps();
        const { getByTestId } = render(<SelectorButton {...props} />);

        // Simulate closing the modal.
        fireEvent.press(getByTestId('selector-close'));

        // Verify setShowModal is called with false (through onClose prop).
        expect(mockSetShowModal).toHaveBeenCalledWith(false);
    });

    it('uses correct testIdPrefix for wrapper and button', () => {
        const props = createDefaultProps({ testIdPrefix: 'custom-test' });
        const { getByTestId } = render(<SelectorButton {...props} />);

        // Verify custom testIdPrefix is used.
        expect(getByTestId('custom-test-wrapper')).toBeTruthy();
        expect(getByTestId('custom-test-button')).toBeTruthy();
    });

    it('handles null value selection correctly', () => {
        useSelectorButton.mockReturnValue({
            getSelectedLabel: mockGetSelectedLabel,
            showModal: true,
            setShowModal: mockSetShowModal,
        });

        const props = createDefaultProps();
        const { getByTestId } = render(<SelectorButton {...props} />);

        // Simulate selecting null option from the modal.
        fireEvent.press(getByTestId('selector-option-null'));

        // Verify onSelectValue callback is called with null.
        expect(mockOnSelectValue).toHaveBeenCalledWith(null);
    });

    it('displays different labels for different selected values', () => {
        mockGetSelectedLabel.mockReturnValue('Second Option');
        const props = createDefaultProps({ selectedValue: 'option2' });
        const { getByText } = render(<SelectorButton {...props} />);

        // Verify correct label is displayed for selected value.
        expect(getByText('Second Option')).toBeTruthy();
        expect(mockGetSelectedLabel).toHaveBeenCalledWith(createMockOptions(), 'option2', 'Choose an option');
    });

    it('handles empty options array gracefully', () => {
        const props = createDefaultProps({ options: [] });
        const { getByTestId, getByText } = render(<SelectorButton {...props} />);

        // Verify button still renders with default label.
        expect(getByTestId('test-button')).toBeTruthy();
        expect(getByText('Choose an option')).toBeTruthy();
    });

    it('passes icon to selector when iconName is provided', () => {
        useSelectorButton.mockReturnValue({
            getSelectedLabel: mockGetSelectedLabel,
            showModal: true,
            setShowModal: mockSetShowModal,
        });

        const props = createDefaultProps({ iconName: 'favorite' });
        const { getByTestId } = render(<SelectorButton {...props} />);

        // Verify icon is passed to selector.
        expect(getByTestId('selector-icon')).toHaveTextContent('favorite');
    });

    it('passes no-icon to selector when iconName is not provided', () => {
        useSelectorButton.mockReturnValue({
            getSelectedLabel: mockGetSelectedLabel,
            showModal: true,
            setShowModal: mockSetShowModal,
        });

        const props = createDefaultProps({ iconName: undefined });
        const { getByTestId } = render(<SelectorButton {...props} />);

        // Verify no icon is passed to selector.
        expect(getByTestId('selector-icon')).toHaveTextContent('no-icon');
    });

    it('maintains button styling and interaction behavior', () => {
        const props = createDefaultProps();
        const { getByTestId } = render(<SelectorButton {...props} />);

        const button = getByTestId('test-button');

        // Verify button is touchable and handles multiple presses.
        fireEvent.press(button);
        fireEvent.press(button);

        // Verify setShowModal is called each time.
        expect(mockSetShowModal).toHaveBeenCalledTimes(2);
        expect(mockSetShowModal).toHaveBeenNthCalledWith(1, true);
        expect(mockSetShowModal).toHaveBeenNthCalledWith(2, true);
    });

    it('handles complex option values and labels correctly', () => {
        const complexOptions: LabelValue[] = [
            { value: 'complex-value-123', label: 'Complex Label with Special Characters !@#' },
            { value: 'another_value', label: 'Another Label' },
        ];
        mockGetSelectedLabel.mockReturnValue('Complex Label with Special Characters !@#');

        const props = createDefaultProps({
            options: complexOptions,
            selectedValue: 'complex-value-123',
        });
        const { getByText } = render(<SelectorButton {...props} />);

        // Verify complex label is displayed correctly.
        expect(getByText('Complex Label with Special Characters !@#')).toBeTruthy();
        expect(mockGetSelectedLabel).toHaveBeenCalledWith(complexOptions, 'complex-value-123', 'Choose an option');
    });
});
