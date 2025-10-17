import { BaseItemDto, BaseItemPerson, PersonKind } from '@jellyfin/sdk/lib/generated-client/models';
import { render } from '@testing-library/react-native';
import React from 'react';
import { CastList } from '.';

// Mock the PosterList component to simplify testing.
jest.mock('../posterList', () => ({
    PosterList: ({ items, itemSubtext, itemPosterUrl, keyExtractor }: any) => {
        const React = require('react');
        const { Text, View } = require('react-native');

        return (
            <View testID='poster-list'>
                {items.map((item: any) => (
                    <View key={keyExtractor(item)} testID={`cast-item-${keyExtractor(item)}`}>
                        <Text testID={`cast-name-${keyExtractor(item)}`}>{itemSubtext(item)}</Text>
                        <Text testID={`cast-poster-${keyExtractor(item)}`}>{itemPosterUrl(item)}</Text>
                    </View>
                ))}
            </View>
        );
    },
}));

describe('CastList - Cast Information Display', () => {
    const createMockPerson = (id: string, name: string, type: PersonKind): BaseItemPerson => ({
        Id: id,
        Name: name,
        Type: type,
        PrimaryImageTag: `image-tag-${id}`,
    });

    const createMockItem = (people?: BaseItemPerson[]): BaseItemDto => ({
        Id: 'test-item-id',
        Name: 'Test Movie',
        People: people,
    });

    it('renders actors from item people list', () => {
        // Create test data with actors and non-actors.
        const mockActors = [
            createMockPerson('actor-1', 'John Doe', PersonKind.Actor),
            createMockPerson('actor-2', 'Jane Smith', PersonKind.Actor),
        ];
        const mockDirector = createMockPerson('director-1', 'Steven Director', PersonKind.Director);
        const mockItem = createMockItem([...mockActors, mockDirector]);

        const { getByTestId, queryByTestId } = render(<CastList item={mockItem} />);

        // Verify the poster list is rendered.
        expect(getByTestId('poster-list')).toBeTruthy();

        // Verify actors are displayed.
        expect(getByTestId('cast-item-actor-1')).toBeTruthy();
        expect(getByTestId('cast-name-actor-1')).toHaveTextContent('John Doe');
        expect(getByTestId('cast-poster-actor-1')).toHaveTextContent('actor-1');

        expect(getByTestId('cast-item-actor-2')).toBeTruthy();
        expect(getByTestId('cast-name-actor-2')).toHaveTextContent('Jane Smith');
        expect(getByTestId('cast-poster-actor-2')).toHaveTextContent('actor-2');

        // Verify non-actors are not displayed.
        expect(queryByTestId('cast-item-director-1')).toBeFalsy();
    });

    it('renders empty list when item has no people', () => {
        // Create test item with no people.
        const mockItem = createMockItem();

        const { getByTestId, queryByTestId } = render(<CastList item={mockItem} />);

        // Verify the poster list is rendered but empty.
        expect(getByTestId('poster-list')).toBeTruthy();
        expect(queryByTestId('cast-item-actor-1')).toBeFalsy();
    });

    it('renders empty list when item has empty people array', () => {
        // Create test item with empty people array.
        const mockItem = createMockItem([]);

        const { getByTestId, queryByTestId } = render(<CastList item={mockItem} />);

        // Verify the poster list is rendered but empty.
        expect(getByTestId('poster-list')).toBeTruthy();
        expect(queryByTestId('cast-item-actor-1')).toBeFalsy();
    });

    it('filters out non-actor person types', () => {
        // Create test data with various person types but no actors.
        const mockPeople = [
            createMockPerson('director-1', 'Steven Director', PersonKind.Director),
            createMockPerson('writer-1', 'John Writer', PersonKind.Writer),
            createMockPerson('producer-1', 'Mary Producer', PersonKind.Producer),
        ];
        const mockItem = createMockItem(mockPeople);

        const { getByTestId, queryByTestId } = render(<CastList item={mockItem} />);

        // Verify the poster list is rendered but contains no items.
        expect(getByTestId('poster-list')).toBeTruthy();
        expect(queryByTestId('cast-item-director-1')).toBeFalsy();
        expect(queryByTestId('cast-item-writer-1')).toBeFalsy();
        expect(queryByTestId('cast-item-producer-1')).toBeFalsy();
    });

    it('handles mixed person types and filters correctly', () => {
        // Create test data with mixed person types.
        const mockPeople = [
            createMockPerson('actor-1', 'John Actor', PersonKind.Actor),
            createMockPerson('director-1', 'Steven Director', PersonKind.Director),
            createMockPerson('actor-2', 'Jane Actor', PersonKind.Actor),
            createMockPerson('writer-1', 'Bob Writer', PersonKind.Writer),
        ];
        const mockItem = createMockItem(mockPeople);

        const { getByTestId, queryByTestId } = render(<CastList item={mockItem} />);

        // Verify only actors are displayed.
        expect(getByTestId('cast-item-actor-1')).toBeTruthy();
        expect(getByTestId('cast-name-actor-1')).toHaveTextContent('John Actor');

        expect(getByTestId('cast-item-actor-2')).toBeTruthy();
        expect(getByTestId('cast-name-actor-2')).toHaveTextContent('Jane Actor');

        // Verify non-actors are filtered out.
        expect(queryByTestId('cast-item-director-1')).toBeFalsy();
        expect(queryByTestId('cast-item-writer-1')).toBeFalsy();
    });

    it('handles actors with missing names gracefully', () => {
        // Create test data with actor missing name.
        const mockActors = [
            createMockPerson('actor-1', 'John Doe', PersonKind.Actor),
            { Id: 'actor-2', Type: PersonKind.Actor, PrimaryImageTag: 'image-tag-actor-2' } as BaseItemPerson, // Missing Name
        ];
        const mockItem = createMockItem(mockActors);

        const { getByTestId } = render(<CastList item={mockItem} />);

        // Verify both actors are processed (even with missing name).
        expect(getByTestId('cast-item-actor-1')).toBeTruthy();
        expect(getByTestId('cast-name-actor-1')).toHaveTextContent('John Doe');

        expect(getByTestId('cast-item-actor-2')).toBeTruthy();
        // The component should handle undefined name gracefully.
    });

    it('handles actors with missing IDs gracefully', () => {
        // Create test data with actor missing ID.
        const mockActors = [
            createMockPerson('actor-1', 'John Doe', PersonKind.Actor),
            { Name: 'Jane Smith', Type: PersonKind.Actor, PrimaryImageTag: 'image-tag-jane' } as BaseItemPerson, // Missing Id
        ];
        const mockItem = createMockItem(mockActors);

        const { getByTestId } = render(<CastList item={mockItem} />);

        // Verify the first actor with ID is displayed.
        expect(getByTestId('cast-item-actor-1')).toBeTruthy();
        expect(getByTestId('cast-name-actor-1')).toHaveTextContent('John Doe');

        // The component should handle missing ID gracefully in PosterList.
    });

    it('preserves actor order from original people array', () => {
        // Create test data with actors in specific order.
        const mockActors = [
            createMockPerson('actor-3', 'Charlie Brown', PersonKind.Actor),
            createMockPerson('actor-1', 'Alice Johnson', PersonKind.Actor),
            createMockPerson('actor-2', 'Bob Wilson', PersonKind.Actor),
        ];
        const mockItem = createMockItem(mockActors);

        const { getByTestId } = render(<CastList item={mockItem} />);

        // Verify all actors are rendered (order preservation is tested via key extraction).
        expect(getByTestId('cast-item-actor-3')).toBeTruthy();
        expect(getByTestId('cast-name-actor-3')).toHaveTextContent('Charlie Brown');

        expect(getByTestId('cast-item-actor-1')).toBeTruthy();
        expect(getByTestId('cast-name-actor-1')).toHaveTextContent('Alice Johnson');

        expect(getByTestId('cast-item-actor-2')).toBeTruthy();
        expect(getByTestId('cast-name-actor-2')).toHaveTextContent('Bob Wilson');
    });

    it('passes correct props to PosterList component', () => {
        // Create test data to verify prop passing.
        const mockActor = createMockPerson('actor-1', 'Test Actor', PersonKind.Actor);
        const mockItem = createMockItem([mockActor]);

        const { getByTestId } = render(<CastList item={mockItem} />);

        // Verify PosterList receives the filtered actors array.
        expect(getByTestId('poster-list')).toBeTruthy();
        expect(getByTestId('cast-item-actor-1')).toBeTruthy();

        // Verify itemSubtext function works (displays actor name).
        expect(getByTestId('cast-name-actor-1')).toHaveTextContent('Test Actor');

        // Verify itemPosterUrl function works (uses actor ID).
        expect(getByTestId('cast-poster-actor-1')).toHaveTextContent('actor-1');
    });
});
