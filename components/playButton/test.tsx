import { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { PlayButton, PlayButtonProps } from '.';

// Mock dependencies
jest.mock('expo-router', () => ({
    useRouter: jest.fn(),
}));

jest.mock('@/contexts/cast', () => ({
    useCast: jest.fn(),
}));

jest.mock('react-native-google-cast', () => ({
    useRemoteMediaClient: jest.fn(),
}));

jest.mock('../toast', () => ({
    useToast: jest.fn(),
}));

jest.mock('../button', () => ({
    PrimaryButton: ({ onPress, children }: any) => {
        const { TouchableOpacity } = require('react-native');
        return (
            <TouchableOpacity testID='primary-button' onPress={onPress}>
                {children}
            </TouchableOpacity>
        );
    },
}));

// Mock AntDesign and FontAwesome icons
jest.mock('@expo/vector-icons', () => ({
    FontAwesome: ({ name, size, color }: any) => {
        const { View, Text } = require('react-native');
        return (
            <View testID={`fontawesome-${name}`}>
                <Text>{`${name}-${size}-${color}`}</Text>
            </View>
        );
    },
    AntDesign: ({ name, size, color, style }: any) => {
        const { View, Text } = require('react-native');
        return (
            <View testID={`antdesign-${name}`} style={style}>
                <Text>{`${name}-${size}-${color}`}</Text>
            </View>
        );
    },
}));

describe('PlayButton', () => {
    const mockPush = jest.fn();
    const mockCast = jest.fn();
    const mockToastError = jest.fn();

    // Import mocked modules
    const { useRouter } = require('expo-router');
    const { useCast } = require('@/contexts/cast');
    const { useRemoteMediaClient } = require('react-native-google-cast');
    const { useToast } = require('../toast');

    const createMockItem = (overrides: Partial<BaseItemDto> = {}): BaseItemDto => ({
        Id: 'test-item-id',
        Name: 'Test Movie',
        MediaSources: [
            {
                Id: 'media-source-1',
                Protocol: 'File',
            },
        ],
        UserData: {
            PlaybackPositionTicks: 0,
        },
        ...overrides,
    });

    const createDefaultProps = (overrides: Partial<PlayButtonProps> = {}): PlayButtonProps => ({
        item: createMockItem(),
        ...overrides,
    });

    beforeEach(() => {
        jest.clearAllMocks();

        // Setup default mocks
        useRouter.mockReturnValue({ push: mockPush });
        useCast.mockReturnValue({ cast: mockCast });
        useRemoteMediaClient.mockReturnValue(null);
        useToast.mockReturnValue({ error: mockToastError });
    });

    it('renders play button with play icon', () => {
        const props = createDefaultProps();
        const { getByTestId } = render(<PlayButton {...props} />);

        // Verify primary button is rendered.
        expect(getByTestId('primary-button')).toBeTruthy();

        // Verify play icon is displayed.
        expect(getByTestId('fontawesome-play')).toBeTruthy();
    });

    it('displays resume indicator when item is resumable', () => {
        const resumableItem = createMockItem({
            UserData: {
                PlaybackPositionTicks: 5000000, // Some progress
            },
        });
        const props = createDefaultProps({ item: resumableItem });
        const { getByTestId } = render(<PlayButton {...props} />);

        // Verify both play icon and clock icon are displayed.
        expect(getByTestId('fontawesome-play')).toBeTruthy();
        expect(getByTestId('antdesign-clockcircle')).toBeTruthy();
    });

    it('does not display resume indicator when item is not resumable', () => {
        const newItem = createMockItem({
            UserData: {
                PlaybackPositionTicks: 0, // No progress
            },
        });
        const props = createDefaultProps({ item: newItem });
        const { getByTestId, queryByTestId } = render(<PlayButton {...props} />);

        // Verify play icon is displayed but no clock icon.
        expect(getByTestId('fontawesome-play')).toBeTruthy();
        expect(queryByTestId('antdesign-clockcircle')).toBeFalsy();
    });

    it('handles resume indicator when UserData is missing', () => {
        const itemWithoutUserData = createMockItem({
            UserData: undefined,
        });
        const props = createDefaultProps({ item: itemWithoutUserData });
        const { getByTestId, queryByTestId } = render(<PlayButton {...props} />);

        // Verify play icon is displayed but no clock icon.
        expect(getByTestId('fontawesome-play')).toBeTruthy();
        expect(queryByTestId('antdesign-clockcircle')).toBeFalsy();
    });

    it('navigates to video player when no cast client available', async () => {
        useRemoteMediaClient.mockReturnValue(null);
        const props = createDefaultProps();
        const { getByTestId } = render(<PlayButton {...props} />);

        // Simulate button press.
        fireEvent.press(getByTestId('primary-button'));

        await waitFor(() => {
            // Verify navigation to local video player.
            expect(mockPush).toHaveBeenCalledWith('/video/test-item-id/media-source-1');
            expect(mockCast).not.toHaveBeenCalled();
        });
    });

    it('navigates to remote screen and casts when cast client available', async () => {
        const mockClient = {};
        useRemoteMediaClient.mockReturnValue(mockClient);
        const props = createDefaultProps();
        const { getByTestId } = render(<PlayButton {...props} />);

        // Simulate button press.
        fireEvent.press(getByTestId('primary-button'));

        await waitFor(() => {
            // Verify casting and navigation to remote screen.
            expect(mockCast).toHaveBeenCalledWith(props.item);
            expect(mockPush).toHaveBeenCalledWith('/remote/test-item-id/media-source-1');
        });
    });

    it('shows error toast when item is missing', async () => {
        const props = createDefaultProps({ item: undefined as any });
        const { getByTestId } = render(<PlayButton {...props} />);

        // Simulate button press.
        fireEvent.press(getByTestId('primary-button'));

        await waitFor(() => {
            // Verify error toast is shown.
            expect(mockToastError).toHaveBeenCalledWith('Unable to play media. Please try again later.');
            expect(mockPush).not.toHaveBeenCalled();
        });
    });

    it('shows error toast when MediaSources is missing', async () => {
        const itemWithoutSources = createMockItem({
            MediaSources: undefined,
        });
        const props = createDefaultProps({ item: itemWithoutSources });
        const { getByTestId } = render(<PlayButton {...props} />);

        // Simulate button press.
        fireEvent.press(getByTestId('primary-button'));

        await waitFor(() => {
            // Verify error toast is shown.
            expect(mockToastError).toHaveBeenCalledWith('Unable to play media. Please try again later.');
            expect(mockPush).not.toHaveBeenCalled();
        });
    });

    it('shows error toast when MediaSources array is empty', async () => {
        const itemWithEmptySources = createMockItem({
            MediaSources: [],
        });
        const props = createDefaultProps({ item: itemWithEmptySources });
        const { getByTestId } = render(<PlayButton {...props} />);

        // Simulate button press.
        fireEvent.press(getByTestId('primary-button'));

        await waitFor(() => {
            // Verify error toast is shown.
            expect(mockToastError).toHaveBeenCalledWith('Unable to play media. Please try again later.');
            expect(mockPush).not.toHaveBeenCalled();
        });
    });

    it('uses first media source for navigation URL', async () => {
        const itemWithMultipleSources = createMockItem({
            MediaSources: [
                { Id: 'source-1', Protocol: 'File' },
                { Id: 'source-2', Protocol: 'Http' },
            ],
        });
        const props = createDefaultProps({ item: itemWithMultipleSources });
        const { getByTestId } = render(<PlayButton {...props} />);

        // Simulate button press.
        fireEvent.press(getByTestId('primary-button'));

        await waitFor(() => {
            // Verify navigation uses first media source.
            expect(mockPush).toHaveBeenCalledWith('/video/test-item-id/source-1');
        });
    });

    it('handles cast and navigation simultaneously', async () => {
        const mockClient = {};
        useRemoteMediaClient.mockReturnValue(mockClient);
        const props = createDefaultProps();
        const { getByTestId } = render(<PlayButton {...props} />);

        // Simulate button press.
        fireEvent.press(getByTestId('primary-button'));

        await waitFor(() => {
            // Verify both casting and navigation occur.
            expect(mockCast).toHaveBeenCalledWith(props.item);
            expect(mockPush).toHaveBeenCalledWith('/remote/test-item-id/media-source-1');
        });
    });

    it('passes through additional ButtonProps to PrimaryButton', () => {
        const props = createDefaultProps({
            text: 'Custom Play Text',
            isDisabled: true,
        });
        const { getByTestId } = render(<PlayButton {...props} />);

        // Verify button is rendered (props are passed through).
        expect(getByTestId('primary-button')).toBeTruthy();
    });

    it('handles resumable item with high PlaybackPositionTicks', () => {
        const highProgressItem = createMockItem({
            UserData: {
                PlaybackPositionTicks: 90000000, // High progress value
            },
        });
        const props = createDefaultProps({ item: highProgressItem });
        const { getByTestId } = render(<PlayButton {...props} />);

        // Verify resume indicator is shown for high progress.
        expect(getByTestId('antdesign-clockcircle')).toBeTruthy();
    });

    it('treats zero PlaybackPositionTicks as not resumable', () => {
        const zeroProgressItem = createMockItem({
            UserData: {
                PlaybackPositionTicks: 0,
            },
        });
        const props = createDefaultProps({ item: zeroProgressItem });
        const { queryByTestId } = render(<PlayButton {...props} />);

        // Verify no resume indicator for zero progress.
        expect(queryByTestId('antdesign-clockcircle')).toBeFalsy();
    });

    it('handles missing PlaybackPositionTicks in UserData', () => {
        const itemWithoutTicks = createMockItem({
            UserData: {}, // No PlaybackPositionTicks property
        });
        const props = createDefaultProps({ item: itemWithoutTicks });
        const { queryByTestId } = render(<PlayButton {...props} />);

        // Verify no resume indicator when PlaybackPositionTicks is missing.
        expect(queryByTestId('antdesign-clockcircle')).toBeFalsy();
    });

    it('handles errors during casting gracefully', async () => {
        const mockClient = {};
        useRemoteMediaClient.mockReturnValue(mockClient);
        mockCast.mockImplementation(() => {
            throw new Error('Cast error');
        });
        const props = createDefaultProps();
        const { getByTestId } = render(<PlayButton {...props} />);

        // Simulate button press.
        fireEvent.press(getByTestId('primary-button'));

        await waitFor(() => {
            // Verify error is handled and toast is shown.
            expect(mockToastError).toHaveBeenCalledWith('Unable to play media. Please try again later.');
        });
    });

    it('handles errors during navigation gracefully', async () => {
        mockPush.mockImplementation(() => {
            throw new Error('Navigation error');
        });
        const props = createDefaultProps();
        const { getByTestId } = render(<PlayButton {...props} />);

        // Simulate button press.
        fireEvent.press(getByTestId('primary-button'));

        await waitFor(() => {
            // Verify error is handled and toast is shown.
            expect(mockToastError).toHaveBeenCalledWith('Unable to play media. Please try again later.');
        });
    });

    it('displays correct icon colors and sizes', () => {
        const props = createDefaultProps({
            item: createMockItem({
                UserData: { PlaybackPositionTicks: 1000 },
            }),
        });
        const { getByText } = render(<PlayButton {...props} />);

        // Verify play icon properties.
        expect(getByText('play-22-white')).toBeTruthy();

        // Verify clock icon properties.
        expect(getByText('clockcircle-12-black')).toBeTruthy();
    });
});
