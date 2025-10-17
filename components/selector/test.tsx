import { LabelValue } from '@/models';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { Selector } from '.';

// Mock dependencies
jest.mock('react-native-portalize', () => ({
    Portal: ({ children }: any) => children,
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
    useSelector: jest.fn(),
}));

jest.mock('../toast', () => ({
    useToast: jest.fn(),
}));

jest.mock('@react-navigation/native', () => ({
    useFocusEffect: jest.fn(callback => callback()),
}));

describe('Selector', () => {
    const mockOnClose = jest.fn(),
        mockOnSelectValue = jest.fn(),
        mockHandleSelectValue = jest.fn();

    // Import mocked modules
    const { useSelector } = require('./hook');

    const createMockOptions = (): LabelValue[] => [
        { value: 'option1', label: 'First Option' },
        { value: 'option2', label: 'Second Option' },
        { value: 'option3', label: 'Third Option' },
        { value: null, label: 'None' },
    ];

    const createDefaultProps = (overrides: Partial<Parameters<typeof Selector>[0]> = {}) => ({
        visible: true,
        onClose: mockOnClose,
        title: 'Select an Option',
        options: createMockOptions(),
        selectedValue: null,
        onSelectValue: mockOnSelectValue,
        ...overrides,
    });

    beforeEach(() => {
        jest.clearAllMocks();

        // Setup default hook mock
        useSelector.mockReturnValue({
            slideAnim: { setValue: jest.fn() },
            fadeAnim: { setValue: jest.fn() },
            isVisible: true,
            handleSelectValue: mockHandleSelectValue,
        });
    });

    it('renders selector with title and options when visible', () => {
        const props = createDefaultProps();
        const { getByText } = render(<Selector {...props} />);

        // Verify title is displayed.
        expect(getByText('Select an Option')).toBeTruthy();

        // Verify all options are displayed.
        expect(getByText('First Option')).toBeTruthy();
        expect(getByText('Second Option')).toBeTruthy();
        expect(getByText('Third Option')).toBeTruthy();
        expect(getByText('None')).toBeTruthy();
    });

    it('does not render when hook indicates not visible', () => {
        useSelector.mockReturnValue({
            slideAnim: { setValue: jest.fn() },
            fadeAnim: { setValue: jest.fn() },
            isVisible: false,
            handleSelectValue: mockHandleSelectValue,
        });

        const props = createDefaultProps();
        const { queryByText } = render(<Selector {...props} />);

        // Verify selector is not rendered when not visible.
        expect(queryByText('Select an Option')).toBeFalsy();
    });

    it('displays icon when provided', () => {
        const props = createDefaultProps({ icon: 'settings' });
        const { getByTestId } = render(<Selector {...props} />);

        // Verify icon is displayed in header.
        expect(getByTestId('material-icon-settings')).toBeTruthy();
    });

    it('does not display icon when not provided', () => {
        const props = createDefaultProps({ icon: undefined });
        const { queryByTestId } = render(<Selector {...props} />);

        // Verify no icon is displayed when not provided.
        expect(queryByTestId('material-icon-settings')).toBeFalsy();
    });

    it('displays close button and handles close press', () => {
        const props = createDefaultProps();
        const { getByTestId } = render(<Selector {...props} />);

        // Verify close button is displayed.
        const closeButton = getByTestId('material-icon-close');
        expect(closeButton).toBeTruthy();

        // Simulate close button press.
        fireEvent.press(closeButton.parent!);

        // Verify onClose callback is called.
        expect(mockOnClose).toHaveBeenCalledTimes(1);
    });

    it('handles backdrop press to close selector', () => {
        const props = createDefaultProps();
        const { getByTestId } = render(<Selector {...props} />);

        // Find and press backdrop (we'll need to identify it by its style or testID).
        const backdrop = getByTestId('backdrop');
        fireEvent.press(backdrop);

        // Verify onClose callback is called.
        expect(mockOnClose).toHaveBeenCalledTimes(1);
    });

    it('highlights selected option with check mark', () => {
        const props = createDefaultProps({ selectedValue: 'option2' });
        const { getByTestId, getByText } = render(<Selector {...props} />);

        // Verify selected option is highlighted and has check mark.
        expect(getByText('Second Option')).toBeTruthy();
        expect(getByTestId('material-icon-check')).toBeTruthy();
    });

    it('handles option selection correctly', () => {
        const props = createDefaultProps();
        const { getByText } = render(<Selector {...props} />);

        // Simulate selecting an option.
        fireEvent.press(getByText('Second Option'));

        // Verify handleSelectValue is called with correct value.
        expect(mockHandleSelectValue).toHaveBeenCalledWith('option2');
    });

    it('handles null value selection correctly', () => {
        const props = createDefaultProps();
        const { getByText } = render(<Selector {...props} />);

        // Simulate selecting null option.
        fireEvent.press(getByText('None'));

        // Verify handleSelectValue is called with null value.
        expect(mockHandleSelectValue).toHaveBeenCalledWith(null);
    });

    it('displays multiple options with different selection states', () => {
        const options: LabelValue[] = [
            { value: 'selected', label: 'Selected Option' },
            { value: 'unselected1', label: 'Unselected Option 1' },
            { value: 'unselected2', label: 'Unselected Option 2' },
        ];
        const props = createDefaultProps({ options, selectedValue: 'selected' });
        const { getByText, getAllByTestId, queryAllByTestId } = render(<Selector {...props} />);

        // Verify all options are displayed.
        expect(getByText('Selected Option')).toBeTruthy();
        expect(getByText('Unselected Option 1')).toBeTruthy();
        expect(getByText('Unselected Option 2')).toBeTruthy();

        // Verify only selected option has check mark.
        const checkMarks = queryAllByTestId('material-icon-check');
        expect(checkMarks).toHaveLength(1);
    });

    it('handles empty options array gracefully', () => {
        const props = createDefaultProps({ options: [] });
        const { getByText, queryByText } = render(<Selector {...props} />);

        // Verify title is still displayed but no options.
        expect(getByText('Select an Option')).toBeTruthy();
        expect(queryByText('First Option')).toBeFalsy();
    });

    it('passes correct parameters to useSelector hook', () => {
        const props = createDefaultProps({
            visible: false,
            onSelectValue: mockOnSelectValue,
            onClose: mockOnClose,
        });
        render(<Selector {...props} />);

        // Verify hook is called with correct parameters.
        expect(useSelector).toHaveBeenCalledWith(false, mockOnSelectValue, mockOnClose);
    });

    it('displays different titles correctly', () => {
        const props = createDefaultProps({ title: 'Custom Title' });
        const { getByText } = render(<Selector {...props} />);

        // Verify custom title is displayed.
        expect(getByText('Custom Title')).toBeTruthy();
    });

    it('handles selection when no selectedValue is provided', () => {
        const optionsWithoutNull: LabelValue[] = [
            { value: 'option1', label: 'First Option' },
            { value: 'option2', label: 'Second Option' },
            { value: 'option3', label: 'Third Option' },
        ];
        const props = createDefaultProps({
            selectedValue: 'non-existent-value',
            options: optionsWithoutNull,
        });
        const { queryAllByTestId } = render(<Selector {...props} />);

        // Verify no check marks are displayed when selected value doesn't match any option.
        const checkMarks = queryAllByTestId('material-icon-check');
        expect(checkMarks).toHaveLength(0);
    });

    it('handles long option lists with scroll behavior', () => {
        const manyOptions: LabelValue[] = Array.from({ length: 20 }, (_, i) => ({
            value: `option${i}`,
            label: `Option ${i + 1}`,
        }));
        const props = createDefaultProps({ options: manyOptions });
        const { getByText } = render(<Selector {...props} />);

        // Verify first and last options are rendered (ScrollView should handle the rest).
        expect(getByText('Option 1')).toBeTruthy();
        expect(getByText('Option 20')).toBeTruthy();
    });

    it('handles option selection with complex values', () => {
        const complexOptions: LabelValue[] = [
            { value: 'complex-value-123', label: 'Complex Label with Special Characters !@#' },
            { value: 'another-complex-value', label: 'Another Complex Option' },
        ];
        const props = createDefaultProps({ options: complexOptions });
        const { getByText } = render(<Selector {...props} />);

        // Simulate selecting complex option.
        fireEvent.press(getByText('Complex Label with Special Characters !@#'));

        // Verify handleSelectValue is called with complex value.
        expect(mockHandleSelectValue).toHaveBeenCalledWith('complex-value-123');
    });

    it('maintains proper styling for selected and unselected options', () => {
        const props = createDefaultProps({ selectedValue: 'option1' });
        const { getByText } = render(<Selector {...props} />);

        // Verify selected option text is rendered (styling is applied via style props).
        const selectedOption = getByText('First Option');
        expect(selectedOption).toBeTruthy();

        // Verify unselected options are also rendered.
        expect(getByText('Second Option')).toBeTruthy();
        expect(getByText('Third Option')).toBeTruthy();
    });

    it('handles rapid option selection correctly', async () => {
        const props = createDefaultProps();
        const { getByText } = render(<Selector {...props} />);

        // Simulate rapid selections.
        fireEvent.press(getByText('First Option'));
        fireEvent.press(getByText('Second Option'));
        fireEvent.press(getByText('Third Option'));

        await waitFor(() => {
            // Verify all selections are registered.
            expect(mockHandleSelectValue).toHaveBeenCalledTimes(3);
            expect(mockHandleSelectValue).toHaveBeenNthCalledWith(1, 'option1');
            expect(mockHandleSelectValue).toHaveBeenNthCalledWith(2, 'option2');
            expect(mockHandleSelectValue).toHaveBeenNthCalledWith(3, 'option3');
        });
    });
});
