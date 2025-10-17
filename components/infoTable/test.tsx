import { BaseItemDto, MediaStreamType, PersonKind } from '@jellyfin/sdk/lib/generated-client/models';
import { render } from '@testing-library/react-native';
import { InfoTable, InfoTableProps } from '.';

describe('InfoTable', () => {
    const createMockItem = (overrides: Partial<BaseItemDto> = {}): BaseItemDto => ({
        Id: 'test-item-id',
        Name: 'Test Movie',
        Genres: ['Action', 'Adventure', 'Drama'],
        People: [
            { Name: 'Christopher Nolan', Type: PersonKind.Director },
            { Name: 'Jonathan Nolan', Type: PersonKind.Writer },
            { Name: 'David S. Goyer', Type: PersonKind.Writer },
            { Name: 'Christian Bale', Type: PersonKind.Actor },
        ],
        MediaStreams: [
            {
                Type: MediaStreamType.Video,
                DisplayTitle: '1080p H.264 Main',
            },
            {
                Type: MediaStreamType.Audio,
                DisplayTitle: 'English - DTS 5.1',
            },
        ],
        ...overrides,
    });

    const createDefaultProps = (overrides: Partial<InfoTableProps> = {}): InfoTableProps => ({
        item: createMockItem(),
        isSubtitlesAvailable: false,
        isForcedSubtitlesAvailable: false,
        ...overrides,
    });

    it('renders info table with complete media information', () => {
        const props = createDefaultProps();
        const { getByText } = render(<InfoTable {...props} />);

        // Verify all info entries are displayed with correct labels.
        expect(getByText('📝  Subtitles')).toBeTruthy();
        expect(getByText('📺  Video')).toBeTruthy();
        expect(getByText('🔊  Audio')).toBeTruthy();
        expect(getByText('🎭  Genres')).toBeTruthy();
        expect(getByText('🎬  Director')).toBeTruthy();
        expect(getByText('✍️  Writers')).toBeTruthy();

        // Verify content values are displayed correctly.
        expect(getByText('None')).toBeTruthy(); // Subtitles
        expect(getByText('1080p H.264 Main')).toBeTruthy(); // Video
        expect(getByText('DTS 5.1')).toBeTruthy(); // Audio (formatted)
        expect(getByText('Action, Adventure, Drama')).toBeTruthy(); // Genres
        expect(getByText('Christopher Nolan')).toBeTruthy(); // Director
        expect(getByText('Jonathan Nolan, David S. Goyer')).toBeTruthy(); // Writers
    });

    it('displays "Closed Captions" when only regular subtitles available', () => {
        const props = createDefaultProps({
            isSubtitlesAvailable: true,
            isForcedSubtitlesAvailable: false,
        });
        const { getByText } = render(<InfoTable {...props} />);

        expect(getByText('Closed Captions')).toBeTruthy();
    });

    it('displays "Forced" when only forced subtitles available', () => {
        const props = createDefaultProps({
            isSubtitlesAvailable: false,
            isForcedSubtitlesAvailable: true,
        });
        const { getByText } = render(<InfoTable {...props} />);

        expect(getByText('Forced')).toBeTruthy();
    });

    it('displays "Closed Captions, Forced" when both subtitle types available', () => {
        const props = createDefaultProps({
            isSubtitlesAvailable: true,
            isForcedSubtitlesAvailable: true,
        });
        const { getByText } = render(<InfoTable {...props} />);

        expect(getByText('Closed Captions, Forced')).toBeTruthy();
    });

    it('displays "None" when no subtitles available', () => {
        const props = createDefaultProps({
            isSubtitlesAvailable: false,
            isForcedSubtitlesAvailable: false,
        });
        const { getByText } = render(<InfoTable {...props} />);

        expect(getByText('None')).toBeTruthy();
    });

    it('handles missing genres gracefully', () => {
        const mockItem = createMockItem({ Genres: undefined });
        const props = createDefaultProps({ item: mockItem });
        const { queryByText } = render(<InfoTable {...props} />);

        // Genres entry should not be rendered when no genres available.
        expect(queryByText('🎭  Genres')).toBeFalsy();
    });

    it('handles empty genres array', () => {
        const mockItem = createMockItem({ Genres: [] });
        const props = createDefaultProps({ item: mockItem });
        const { queryByText } = render(<InfoTable {...props} />);

        // Genres entry should not be rendered when genres array is empty.
        expect(queryByText('🎭  Genres')).toBeFalsy();
    });

    it('displays "-" when no director found', () => {
        const mockItem = createMockItem({
            People: [
                { Name: 'Jonathan Nolan', Type: PersonKind.Writer },
                { Name: 'Christian Bale', Type: PersonKind.Actor },
            ],
        });
        const props = createDefaultProps({ item: mockItem });
        const { getByText } = render(<InfoTable {...props} />);

        expect(getByText('🎬  Director')).toBeTruthy();
        expect(getByText('-')).toBeTruthy();
    });

    it('displays "-" when no writers found', () => {
        const mockItem = createMockItem({
            People: [
                { Name: 'Christopher Nolan', Type: PersonKind.Director },
                { Name: 'Christian Bale', Type: PersonKind.Actor },
            ],
        });
        const props = createDefaultProps({ item: mockItem });
        const { getByText } = render(<InfoTable {...props} />);

        expect(getByText('✍️  Writers')).toBeTruthy();
        expect(getByText('-')).toBeTruthy();
    });

    it('limits writers to first 15 entries', () => {
        // Create 20 writers to test the limit.
        const manyWriters = Array.from({ length: 20 }, (_, i) => ({
            Name: `Writer ${i + 1}`,
            Type: PersonKind.Writer,
        }));

        const mockItem = createMockItem({
            People: [{ Name: 'Christopher Nolan', Type: PersonKind.Director }, ...manyWriters],
        });
        const props = createDefaultProps({ item: mockItem });
        const { getByText, queryByText } = render(<InfoTable {...props} />);

        // Verify first 15 writers are included.
        expect(getByText(/Writer 1/)).toBeTruthy();
        expect(getByText(/Writer 15/)).toBeTruthy();

        // Verify writers beyond 15 are not included.
        expect(queryByText(/Writer 16/)).toBeFalsy();
        expect(queryByText(/Writer 20/)).toBeFalsy();
    });

    it('handles missing video stream gracefully', () => {
        const mockItem = createMockItem({
            MediaStreams: [
                {
                    Type: MediaStreamType.Audio,
                    DisplayTitle: 'English - DTS 5.1',
                },
            ],
        });
        const props = createDefaultProps({ item: mockItem });
        const { getByText } = render(<InfoTable {...props} />);

        expect(getByText('📺  Video')).toBeTruthy();
        expect(getByText('-')).toBeTruthy();
    });

    it('handles missing audio stream gracefully', () => {
        const mockItem = createMockItem({
            MediaStreams: [
                {
                    Type: MediaStreamType.Video,
                    DisplayTitle: '1080p H.264 Main',
                },
            ],
        });
        const props = createDefaultProps({ item: mockItem });
        const { getByText } = render(<InfoTable {...props} />);

        expect(getByText('🔊  Audio')).toBeTruthy();
        expect(getByText('-')).toBeTruthy();
    });

    it('formats audio display title by removing language prefix', () => {
        const mockItem = createMockItem({
            MediaStreams: [
                {
                    Type: MediaStreamType.Audio,
                    DisplayTitle: 'English - Dolby Digital 5.1',
                },
            ],
        });
        const props = createDefaultProps({ item: mockItem });
        const { getByText } = render(<InfoTable {...props} />);

        // Should display only the audio format without language prefix.
        expect(getByText('Dolby Digital 5.1')).toBeTruthy();
    });

    it('handles audio display title without language prefix', () => {
        const mockItem = createMockItem({
            MediaStreams: [
                {
                    Type: MediaStreamType.Audio,
                    DisplayTitle: 'DTS-HD Master Audio',
                },
            ],
        });
        const props = createDefaultProps({ item: mockItem });
        const { getByText } = render(<InfoTable {...props} />);

        // Should display the full title when no prefix to remove.
        expect(getByText('DTS-HD Master Audio')).toBeTruthy();
    });

    it('handles audio display title with multiple separators', () => {
        const mockItem = createMockItem({
            MediaStreams: [
                {
                    Type: MediaStreamType.Audio,
                    DisplayTitle: 'English - Dolby Digital - 5.1 - Commentary',
                },
            ],
        });
        const props = createDefaultProps({ item: mockItem });
        const { getByText } = render(<InfoTable {...props} />);

        // Should display everything after the first separator.
        expect(getByText('Dolby Digital - 5.1 - Commentary')).toBeTruthy();
    });

    it('handles empty media streams array', () => {
        const mockItem = createMockItem({ MediaStreams: [] });
        const props = createDefaultProps({ item: mockItem });
        const { getByText, getAllByText } = render(<InfoTable {...props} />);

        // Both video and audio should show "-" when no streams available.
        expect(getByText('📺  Video')).toBeTruthy();
        expect(getByText('🔊  Audio')).toBeTruthy();

        // Should have multiple "-" elements (video, audio, director, writers).
        const dashElements = getAllByText('-');
        expect(dashElements.length).toBeGreaterThanOrEqual(2);
    });

    it('handles missing people array gracefully', () => {
        const mockItem = createMockItem({ People: undefined });
        const props = createDefaultProps({ item: mockItem });
        const { getByText, getAllByText } = render(<InfoTable {...props} />);

        // Director and writers should both show "-" when no people data.
        expect(getByText('🎬  Director')).toBeTruthy();
        expect(getByText('✍️  Writers')).toBeTruthy();

        // Should have multiple "-" elements (director and writers).
        const dashElements = getAllByText('-');
        expect(dashElements.length).toBeGreaterThanOrEqual(2);
    });

    it('does not render info entries with null or undefined values', () => {
        const mockItem = createMockItem({
            Genres: undefined,
            People: undefined,
            MediaStreams: [],
        });
        const props = createDefaultProps({ item: mockItem });
        const { getByText, queryByText } = render(<InfoTable {...props} />);

        // Subtitles should always render (has fallback value).
        expect(getByText('📝  Subtitles')).toBeTruthy();
        expect(getByText('None')).toBeTruthy();

        // Video and audio render with "-" fallback.
        expect(getByText('📺  Video')).toBeTruthy();
        expect(getByText('🔊  Audio')).toBeTruthy();
        expect(getByText('🎬  Director')).toBeTruthy();
        expect(getByText('✍️  Writers')).toBeTruthy();

        // Genres should not render when undefined.
        expect(queryByText('🎭  Genres')).toBeFalsy();
    });

    it('renders single genre correctly', () => {
        const mockItem = createMockItem({ Genres: ['Horror'] });
        const props = createDefaultProps({ item: mockItem });
        const { getByText } = render(<InfoTable {...props} />);

        expect(getByText('🎭  Genres')).toBeTruthy();
        expect(getByText('Horror')).toBeTruthy();
    });

    it('handles single writer correctly', () => {
        const mockItem = createMockItem({
            People: [
                { Name: 'Christopher Nolan', Type: PersonKind.Director },
                { Name: 'Solo Writer', Type: PersonKind.Writer },
            ],
        });
        const props = createDefaultProps({ item: mockItem });
        const { getByText } = render(<InfoTable {...props} />);

        expect(getByText('✍️  Writers')).toBeTruthy();
        expect(getByText('Solo Writer')).toBeTruthy();
    });
});
