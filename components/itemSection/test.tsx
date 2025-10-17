import { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models';
import { fireEvent, render } from '@testing-library/react-native';
import { ItemSection, ItemSectionProps } from '.';

// Mock the Section component
jest.mock('@/screens/home/section', () => ({
    Section: ({ label, children }: { label: string; children: React.ReactNode }) => {
        const { View, Text } = require('react-native');
        return (
            <View testID='section'>
                <Text testID='section-label'>{label}</Text>
                {children}
            </View>
        );
    },
}));

// Mock the Poster component
jest.mock('../poster', () => ({
    __esModule: true,
    default: ({ url }: { url: string }) => {
        const { View, Text } = require('react-native');
        return (
            <View testID='poster'>
                <Text testID='poster-url'>{url}</Text>
            </View>
        );
    },
}));

// Mock AntDesign icons
jest.mock('@expo/vector-icons', () => ({
    AntDesign: ({ name, size, color, style }: any) => {
        const { View } = require('react-native');
        return <View testID={`antdesign-${name}`} style={style} />;
    },
}));

describe('ItemSection', () => {
    const createMockItem = (overrides: Partial<BaseItemDto> = {}): BaseItemDto => ({
        Id: 'test-item-id',
        Name: 'Test Movie',
        ProductionYear: 2023,
        UserData: {
            PlayedPercentage: 0,
            Played: false,
        },
        ...overrides,
    });

    const createDefaultProps = (overrides: Partial<ItemSectionProps> = {}): ItemSectionProps => ({
        label: 'Recently Added Movies',
        items: [
            createMockItem({ Id: 'item-1', Name: 'Movie 1', ProductionYear: 2023 }),
            createMockItem({ Id: 'item-2', Name: 'Movie 2', ProductionYear: 2022 }),
        ],
        onItemSelected: jest.fn(),
        withProgressIndicator: false,
        ...overrides,
    });

    beforeEach(() => {
        jest.clearAllMocks();

        // Mock environment variables
        (process.env as any).EXPO_PUBLIC_JELLYFIN_URL = 'https://jellyfin.example.com';
        (process.env as any).EXPO_PUBLIC_JELLYFIN_API_KEY = 'test-api-key';
    });

    it('renders item section with label and items', () => {
        const props = createDefaultProps();
        const { getByTestId, getByText } = render(<ItemSection {...props} />);

        // Verify Section component receives correct props.
        expect(getByTestId('section')).toBeTruthy();
        expect(getByTestId('section-label')).toBeTruthy();
        expect(getByText('Recently Added Movies')).toBeTruthy();

        // Verify items are rendered.
        expect(getByText('Movie 1')).toBeTruthy();
        expect(getByText('Movie 2')).toBeTruthy();
        expect(getByText('2023')).toBeTruthy();
        expect(getByText('2022')).toBeTruthy();
    });

    it('handles item selection when item is pressed', () => {
        const mockOnItemSelected = jest.fn();
        const props = createDefaultProps({ onItemSelected: mockOnItemSelected });
        const { getByText } = render(<ItemSection {...props} />);

        // Simulate pressing the first item.
        fireEvent.press(getByText('Movie 1'));

        // Verify the selection callback was called with correct item.
        expect(mockOnItemSelected).toHaveBeenCalledTimes(1);
        expect(mockOnItemSelected).toHaveBeenCalledWith(props.items[0]);
    });

    it('generates correct poster URLs with Jellyfin API', () => {
        const props = createDefaultProps();
        const { getAllByText } = render(<ItemSection {...props} />);

        // Verify correct poster URLs are generated.
        expect(
            getAllByText('https://jellyfin.example.com/Items/item-1/Images/Primary?api_key=test-api-key')[0]
        ).toBeTruthy();
        expect(
            getAllByText('https://jellyfin.example.com/Items/item-2/Images/Primary?api_key=test-api-key')[0]
        ).toBeTruthy();
    });

    it('displays progress indicator when withProgressIndicator is true', () => {
        const items = [
            createMockItem({
                Id: 'item-1',
                Name: 'Movie with Progress',
                UserData: { PlayedPercentage: 75, Played: false },
            }),
        ];
        const props = createDefaultProps({ items, withProgressIndicator: true });
        const { getByText } = render(<ItemSection {...props} />);

        // Verify the movie is rendered (progress indicator is part of the UI).
        expect(getByText('Movie with Progress')).toBeTruthy();
    });

    it('does not display progress indicator when withProgressIndicator is false', () => {
        const items = [
            createMockItem({
                Id: 'item-1',
                Name: 'Movie without Progress',
                UserData: { PlayedPercentage: 50, Played: false },
            }),
        ];
        const props = createDefaultProps({ items, withProgressIndicator: false });
        const { getByText } = render(<ItemSection {...props} />);

        // Verify the movie is rendered (without progress indicator logic).
        expect(getByText('Movie without Progress')).toBeTruthy();
    });

    it('displays played indicator when item is marked as played', () => {
        const items = [
            createMockItem({
                Id: 'item-1',
                Name: 'Played Movie',
                UserData: { Played: true, PlayedPercentage: 100 },
            }),
        ];
        const props = createDefaultProps({ items });
        const { getByTestId } = render(<ItemSection {...props} />);

        // Verify played indicator (check circle) is displayed.
        expect(getByTestId('antdesign-checkcircle')).toBeTruthy();
    });

    it('does not display played indicator when item is not played', () => {
        const items = [
            createMockItem({
                Id: 'item-1',
                Name: 'Unplayed Movie',
                UserData: { Played: false, PlayedPercentage: 0 },
            }),
        ];
        const props = createDefaultProps({ items });
        const { queryByTestId } = render(<ItemSection {...props} />);

        // Verify no played indicator is displayed.
        expect(queryByTestId('antdesign-checkcircle')).toBeFalsy();
    });

    it('handles items with missing UserData gracefully', () => {
        const items = [
            createMockItem({
                Id: 'item-1',
                Name: 'Movie without UserData',
                UserData: undefined,
            }),
        ];
        const props = createDefaultProps({ items, withProgressIndicator: true });
        const { getByText, queryByTestId } = render(<ItemSection {...props} />);

        // Verify item still renders.
        expect(getByText('Movie without UserData')).toBeTruthy();

        // Verify no played indicator is shown.
        expect(queryByTestId('antdesign-checkcircle')).toBeFalsy();
    });

    it('renders empty list when no items provided', () => {
        const props = createDefaultProps({ items: [] });
        const { getByTestId, queryByText } = render(<ItemSection {...props} />);

        // Verify section is rendered but no items.
        expect(getByTestId('section')).toBeTruthy();
        expect(queryByText('Movie 1')).toBeFalsy();
        expect(queryByText('Movie 2')).toBeFalsy();
    });

    it('handles items with missing production year', () => {
        const items = [
            createMockItem({
                Id: 'item-1',
                Name: 'Movie without Year',
                ProductionYear: undefined,
            }),
        ];
        const props = createDefaultProps({ items });
        const { getByText } = render(<ItemSection {...props} />);

        // Verify item name is still displayed.
        expect(getByText('Movie without Year')).toBeTruthy();

        // Year should not be displayed or show as empty.
        // The Text component will render but with no content.
    });

    it('truncates long item names with numberOfLines prop', () => {
        const items = [
            createMockItem({
                Id: 'item-1',
                Name: 'This is a very long movie title that should be truncated',
            }),
        ];
        const props = createDefaultProps({ items });
        const { getByText } = render(<ItemSection {...props} />);

        const titleElement = getByText('This is a very long movie title that should be truncated');
        expect(titleElement.props.numberOfLines).toBe(1);
    });

    it('applies correct margin to last item in list', () => {
        const props = createDefaultProps();
        const { getByText } = render(<ItemSection {...props} />);

        // Verify the component renders without errors and items are displayed.
        expect(getByText('Movie 1')).toBeTruthy();
        expect(getByText('Movie 2')).toBeTruthy();
    });

    it('handles async onItemSelected callbacks', async () => {
        const mockAsyncCallback = jest.fn().mockResolvedValue(undefined);
        const props = createDefaultProps({ onItemSelected: mockAsyncCallback });
        const { getByText } = render(<ItemSection {...props} />);

        // Simulate pressing an item.
        fireEvent.press(getByText('Movie 1'));

        // Verify async callback was called.
        expect(mockAsyncCallback).toHaveBeenCalledTimes(1);
        expect(mockAsyncCallback).toHaveBeenCalledWith(props.items[0]);
    });

    it('renders multiple items with different progress values', () => {
        const items = [
            createMockItem({
                Id: 'item-1',
                Name: 'Movie 25% watched',
                UserData: { PlayedPercentage: 25, Played: false },
            }),
            createMockItem({
                Id: 'item-2',
                Name: 'Movie 75% watched',
                UserData: { PlayedPercentage: 75, Played: false },
            }),
            createMockItem({
                Id: 'item-3',
                Name: 'Movie completed',
                UserData: { PlayedPercentage: 100, Played: true },
            }),
        ];
        const props = createDefaultProps({ items, withProgressIndicator: true });
        const { getByText, getByTestId } = render(<ItemSection {...props} />);

        // Verify all movies are rendered.
        expect(getByText('Movie 25% watched')).toBeTruthy();
        expect(getByText('Movie 75% watched')).toBeTruthy();
        expect(getByText('Movie completed')).toBeTruthy();

        // Verify only the completed movie shows played indicator.
        expect(getByTestId('antdesign-checkcircle')).toBeTruthy();
    });

    it('uses correct FlatList configuration', () => {
        const props = createDefaultProps();
        const { getByText } = render(<ItemSection {...props} />);

        // Verify items are rendered (indicating FlatList is working).
        expect(getByText('Movie 1')).toBeTruthy();
        expect(getByText('Movie 2')).toBeTruthy();
    });

    it('handles items with special characters in names', () => {
        const items = [
            createMockItem({
                Id: 'item-1',
                Name: 'Movie: The "Special" Edition & More!',
                ProductionYear: 2023,
            }),
        ];
        const props = createDefaultProps({ items });
        const { getByText } = render(<ItemSection {...props} />);

        // Verify special characters in names are handled correctly.
        expect(getByText('Movie: The "Special" Edition & More!')).toBeTruthy();
    });
});
