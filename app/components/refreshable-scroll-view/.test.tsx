import { act, render, screen } from '@testing-library/react-native';
import { RefreshControl, ScrollView, Text } from 'react-native';

import { buildApiWrapper } from '@/api/test-utils';
import { RefreshableScrollView } from '.';

describe('RefreshableScrollView', () => {
    it('renders its children inside the underlying ScrollView.', () => {
        const { wrapper } = buildApiWrapper();
        render(
            <RefreshableScrollView>
                <Text>child-marker</Text>
            </RefreshableScrollView>,
            { wrapper },
        );

        expect(screen.getByText('child-marker')).toBeOnTheScreen();
        expect(screen.UNSAFE_getByType(ScrollView)).toBeTruthy();
    });

    it('mounts a RefreshControl on the ScrollView whose initial `refreshing` flag is false.', () => {
        const { wrapper } = buildApiWrapper();
        render(
            <RefreshableScrollView>
                <Text>x</Text>
            </RefreshableScrollView>,
            { wrapper },
        );

        const refreshControl = screen.UNSAFE_getByType(RefreshControl);
        expect(refreshControl.props.refreshing).toBe(false);
    });

    it('invokes queryClient.invalidateQueries() exactly once per pull.', async () => {
        const { wrapper, client } = buildApiWrapper();
        const invalidateSpy = jest.spyOn(client, 'invalidateQueries');

        render(
            <RefreshableScrollView>
                <Text>x</Text>
            </RefreshableScrollView>,
            { wrapper },
        );

        const refreshControl = screen.UNSAFE_getByType(RefreshControl);
        await act(async () => {
            await refreshControl.props.onRefresh();
        });

        expect(invalidateSpy).toHaveBeenCalledTimes(1);
    });

    it('flips `refreshing` to true while the invalidate promise is in flight.', async () => {
        const { wrapper, client } = buildApiWrapper();
        let resolveInvalidate: (() => void) | null = null;
        jest.spyOn(client, 'invalidateQueries').mockImplementation(
            () => new Promise<void>(resolve => { resolveInvalidate = resolve; }),
        );

        render(
            <RefreshableScrollView>
                <Text>x</Text>
            </RefreshableScrollView>,
            { wrapper },
        );

        const refreshControl = screen.UNSAFE_getByType(RefreshControl);

        let onRefreshPromise: Promise<void> | undefined;
        await act(async () => {
            onRefreshPromise = refreshControl.props.onRefresh();
        });

        expect(screen.UNSAFE_getByType(RefreshControl).props.refreshing).toBe(true);

        await act(async () => {
            resolveInvalidate?.();
            await onRefreshPromise;
        });
    });

    it('flips `refreshing` back to false once the invalidate promise resolves.', async () => {
        const { wrapper } = buildApiWrapper();

        render(
            <RefreshableScrollView>
                <Text>x</Text>
            </RefreshableScrollView>,
            { wrapper },
        );

        const refreshControl = screen.UNSAFE_getByType(RefreshControl);
        await act(async () => {
            await refreshControl.props.onRefresh();
        });

        expect(screen.UNSAFE_getByType(RefreshControl).props.refreshing).toBe(false);
    });

    it('forwards arbitrary ScrollView props through to the underlying ScrollView.', () => {
        const { wrapper } = buildApiWrapper();
        render(
            <RefreshableScrollView contentContainerStyle={{ padding: 24 }}>
                <Text>x</Text>
            </RefreshableScrollView>,
            { wrapper },
        );

        const scrollView = screen.UNSAFE_getByType(ScrollView);
        expect(scrollView.props.contentContainerStyle).toEqual({ padding: 24 });
    });
});
