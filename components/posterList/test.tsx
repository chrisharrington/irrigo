import { fireEvent, render } from '@testing-library/react-native';
import { PosterList, PosterListProps } from '.';

// Mock dependencies
jest.mock('@/subHeader', () => ({
    SubHeader: ({ children }: any) => {
        const { Text } = require('react-native');
        return <Text testID='sub-header'>{children}</Text>;
    },
}));

jest.mock('../poster', () => {
    const { View, Text } = require('react-native');
    return ({ url }: { url: string }) => (
        <View testID='poster'>
            <Text testID='poster-url'>{url}</Text>
        </View>
    );
});

jest.mock('./hook', () => ({
    usePosterList: jest.fn(),
}));

jest.mock('@/contexts/jellyfin', () => ({
    useJellyfin: jest.fn(),
}));

describe('PosterList', () => {
    const mockGetImageForId = jest.fn(),
        mockOnPressItem = jest.fn();

    // Import mocked modules
    const { usePosterList } = require('./hook');

    type TestItem = {
        id: string;
        name: string;
        imageId: string;
    };

    const createMockItems = (): TestItem[] => [
        { id: 'item-1', name: 'Test Movie 1', imageId: 'image-1' },
        { id: 'item-2', name: 'Test Movie 2', imageId: 'image-2' },
        { id: 'item-3', name: 'Test Movie 3', imageId: 'image-3' },
    ];

    const createDefaultProps = (overrides: Partial<PosterListProps<TestItem>> = {}): PosterListProps<TestItem> => ({
        items: createMockItems(),
        itemSubtext: item => item.name,
        itemPosterUrl: item => item.imageId,
        keyExtractor: item => item.id,
        onPressItem: mockOnPressItem,
        ...overrides,
    });

    beforeEach(() => {
        jest.clearAllMocks();

        // Setup default mocks
        usePosterList.mockReturnValue({
            getImageForId: mockGetImageForId,
        });
        mockGetImageForId.mockImplementation((id: string) => `processed-${id}`);
    });

    it('renders list of posters with correct data', () => {
        const items = createMockItems(),
            props = createDefaultProps({ items });
        const { getByText, getAllByTestId } = render(<PosterList {...props} />);

        // Verify all items are rendered.
        expect(getByText('Test Movie 1')).toBeTruthy();
        expect(getByText('Test Movie 2')).toBeTruthy();
        expect(getByText('Test Movie 3')).toBeTruthy();

        // Verify posters are rendered.
        const posters = getAllByTestId('poster');
        expect(posters).toHaveLength(3);
    });

    it('displays title when provided', () => {
        const props = createDefaultProps({ title: 'Featured Movies' });
        const { getByTestId, getByText } = render(<PosterList {...props} />);

        // Verify title is displayed using SubHeader.
        expect(getByTestId('sub-header')).toBeTruthy();
        expect(getByText('Featured Movies')).toBeTruthy();
    });

    it('does not display title when not provided', () => {
        const props = createDefaultProps({ title: undefined });
        const { queryByTestId } = render(<PosterList {...props} />);

        // Verify no title is displayed.
        expect(queryByTestId('sub-header')).toBeFalsy();
    });

    it('processes poster URLs through getImageForId', () => {
        const items = [{ id: 'test', name: 'Test', imageId: 'test-image' }],
            props = createDefaultProps({ items });
        const { getByTestId } = render(<PosterList {...props} />);

        // Verify getImageForId is called with correct URL.
        expect(mockGetImageForId).toHaveBeenCalledWith('test-image');

        // Verify processed URL is passed to Poster component.
        expect(getByTestId('poster-url')).toHaveTextContent('processed-test-image');
    });

    it('calls onPressItem when poster is pressed', () => {
        const items = createMockItems(),
            props = createDefaultProps({ items });
        const { getByText } = render(<PosterList {...props} />);

        // Simulate pressing first poster.
        const firstPoster = getByText('Test Movie 1').parent;
        fireEvent.press(firstPoster!);

        // Verify onPressItem is called with correct item.
        expect(mockOnPressItem).toHaveBeenCalledWith(items[0]);
    });

    it('handles multiple poster presses correctly', () => {
        const items = createMockItems(),
            props = createDefaultProps({ items });
        const { getByText } = render(<PosterList {...props} />);

        // Simulate pressing different posters.
        fireEvent.press(getByText('Test Movie 1').parent!);
        fireEvent.press(getByText('Test Movie 3').parent!);

        // Verify correct items are passed for each press.
        expect(mockOnPressItem).toHaveBeenCalledTimes(2);
        expect(mockOnPressItem).toHaveBeenNthCalledWith(1, items[0]);
        expect(mockOnPressItem).toHaveBeenNthCalledWith(2, items[2]);
    });

    it('does not crash when onPressItem is not provided', () => {
        const props = createDefaultProps({ onPressItem: undefined });
        const { getByText } = render(<PosterList {...props} />);

        // Simulate pressing poster without onPressItem handler.
        expect(() => {
            fireEvent.press(getByText('Test Movie 1').parent!);
        }).not.toThrow();
    });

    it('renders empty list gracefully', () => {
        const props = createDefaultProps({ items: [] });
        const { queryAllByTestId } = render(<PosterList {...props} />);

        // Verify no posters are rendered for empty list.
        expect(queryAllByTestId('poster')).toHaveLength(0);
    });

    it('uses correct key extractor for list items', () => {
        const customKeyExtractor = jest.fn((item: TestItem) => `custom-${item.id}`),
            props = createDefaultProps({ keyExtractor: customKeyExtractor });
        render(<PosterList {...props} />);

        // Verify key extractor is called with each item (ignoring additional parameters like index).
        const calls = customKeyExtractor.mock.calls.map(call => call[0]);
        const mockItems = createMockItems();

        expect(calls).toContainEqual(mockItems[0]);
        expect(calls).toContainEqual(mockItems[1]);
        expect(calls).toContainEqual(mockItems[2]);
    });

    it('uses correct subtext extractor for item labels', () => {
        const customSubtextExtractor = jest.fn((item: TestItem) => `Label: ${item.name}`),
            props = createDefaultProps({ itemSubtext: customSubtextExtractor });
        const { getByText } = render(<PosterList {...props} />);

        // Verify custom subtext is displayed.
        expect(getByText('Label: Test Movie 1')).toBeTruthy();
        expect(getByText('Label: Test Movie 2')).toBeTruthy();
        expect(getByText('Label: Test Movie 3')).toBeTruthy();
    });

    it('uses correct poster URL extractor for images', () => {
        const customUrlExtractor = jest.fn((item: TestItem) => `custom-${item.imageId}`),
            props = createDefaultProps({ itemPosterUrl: customUrlExtractor });
        render(<PosterList {...props} />);

        // Verify URL extractor is called for each item.
        expect(customUrlExtractor).toHaveBeenCalledTimes(3);
        expect(mockGetImageForId).toHaveBeenCalledWith('custom-image-1');
        expect(mockGetImageForId).toHaveBeenCalledWith('custom-image-2');
        expect(mockGetImageForId).toHaveBeenCalledWith('custom-image-3');
    });

    it('handles single item list correctly', () => {
        const singleItem = [{ id: 'single', name: 'Single Movie', imageId: 'single-image' }],
            props = createDefaultProps({ items: singleItem });
        const { getByText, getAllByTestId } = render(<PosterList {...props} />);

        // Verify single item is rendered correctly.
        expect(getByText('Single Movie')).toBeTruthy();
        expect(getAllByTestId('poster')).toHaveLength(1);
    });

    it('renders with title and items together', () => {
        const props = createDefaultProps({ title: 'My Collection' });
        const { getByText, getAllByTestId } = render(<PosterList {...props} />);

        // Verify both title and items are rendered.
        expect(getByText('My Collection')).toBeTruthy();
        expect(getAllByTestId('poster')).toHaveLength(3);
    });

    it('passes through children when provided', () => {
        const props = createDefaultProps();
        const { Text } = require('react-native');

        // Note: Children would be rendered if the component supports them.
        // This test verifies the component structure accepts children prop.
        expect(() =>
            render(
                <PosterList {...props}>
                    <Text>Test</Text>
                </PosterList>
            )
        ).not.toThrow();
    });

    it('handles different item types with generic support', () => {
        type CustomItem = { identifier: string; title: string; thumbnailId: string };
        const customItems: CustomItem[] = [
            { identifier: 'custom-1', title: 'Custom Title 1', thumbnailId: 'thumb-1' },
            { identifier: 'custom-2', title: 'Custom Title 2', thumbnailId: 'thumb-2' },
        ];

        const customProps: PosterListProps<CustomItem> = {
            items: customItems,
            itemSubtext: item => item.title,
            itemPosterUrl: item => item.thumbnailId,
            keyExtractor: item => item.identifier,
        };

        const { getByText } = render(<PosterList {...customProps} />);

        // Verify generic type support works correctly.
        expect(getByText('Custom Title 1')).toBeTruthy();
        expect(getByText('Custom Title 2')).toBeTruthy();
    });

    it('maintains proper horizontal scroll behavior', () => {
        const props = createDefaultProps();
        const { UNSAFE_getByType } = render(<PosterList {...props} />);
        const { FlatList } = require('react-native');

        // Verify FlatList is configured for horizontal scrolling.
        const flatList = UNSAFE_getByType(FlatList);
        expect(flatList.props.horizontal).toBe(true);
        expect(flatList.props.showsHorizontalScrollIndicator).toBe(false);
    });
});
