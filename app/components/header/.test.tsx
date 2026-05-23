import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { buildApiWrapper, jsonResponse } from '@/api/test-utils';
import { keys } from '@/api/query-keys';
import { Header } from '.';

const mockFetch = jest.fn();

beforeEach(() => {
    (global as { fetch: typeof fetch }).fetch = mockFetch as unknown as typeof fetch;
    mockFetch.mockReset();
    process.env.EXPO_PUBLIC_API_BASE_URL = 'http://test.local:9753';
});

describe('Header', () => {
    it('renders menu, brand, and re-plan controls.', () => {
        const { wrapper, client } = buildApiWrapper();
        client.setQueryData(keys.system.state(), { irrigationEnabled: true, since: 'x' });

        render(<Header onMenuPress={jest.fn()} />, { wrapper });

        expect(screen.getByLabelText('Open menu')).toBeOnTheScreen();
        expect(screen.getByLabelText('Irrigo')).toBeOnTheScreen();
        expect(screen.getByText('Irrigo')).toBeOnTheScreen();
        expect(screen.getByLabelText('Re-plan')).toBeOnTheScreen();
    });

    it('calls onMenuPress when the user taps the menu button while irrigation is on.', () => {
        const onMenuPress = jest.fn();
        const { wrapper, client } = buildApiWrapper();
        client.setQueryData(keys.system.state(), { irrigationEnabled: true, since: 'x' });

        render(<Header onMenuPress={onMenuPress} />, { wrapper });
        fireEvent.press(screen.getByLabelText('Open menu'));

        expect(onMenuPress).toHaveBeenCalledTimes(1);
    });

    it('disables the menu button and ignores presses when irrigation is off.', () => {
        const onMenuPress = jest.fn();
        const { wrapper, client } = buildApiWrapper();
        client.setQueryData(keys.system.state(), { irrigationEnabled: false, since: 'x' });

        render(<Header onMenuPress={onMenuPress} />, { wrapper });
        const menu = screen.getByLabelText('Open menu');
        fireEvent.press(menu);

        expect(onMenuPress).not.toHaveBeenCalled();
        expect(menu.props.accessibilityState).toMatchObject({ disabled: true });
    });

    it('posts to /replan when the user taps the refresh button while irrigation is on.', async () => {
        // First resolved value covers the POST /replan; subsequent
        // mockResolvedValue covers the background GET /system refetch that
        // `useReplan.onSuccess` triggers by invalidating the system query.
        mockFetch.mockResolvedValueOnce(
            jsonResponse({ status: 'replanned', lastRePlanAt: '2026-05-23T03:00:00.000Z' }),
        );
        mockFetch.mockResolvedValue(jsonResponse({ irrigationEnabled: true, since: 'x' }));

        const { wrapper, client } = buildApiWrapper();
        client.setQueryData(keys.system.state(), { irrigationEnabled: true, since: 'x' });

        render(<Header onMenuPress={jest.fn()} />, { wrapper });

        await act(async () => {
            fireEvent.press(screen.getByLabelText('Re-plan'));
        });

        await waitFor(() => {
            const replanCalls = mockFetch.mock.calls.filter(([url]) => String(url).endsWith('/replan'));
            expect(replanCalls).toHaveLength(1);
        });
        const replanCall = mockFetch.mock.calls.find(([url]) => String(url).endsWith('/replan'));
        expect((replanCall as [string, RequestInit])[1].method).toBe('POST');
    });

    it('disables the refresh button and does not POST /replan when irrigation is off.', () => {
        // Seed the system cache. The header still mounts `useSystem`, which
        // will refetch (the seeded entry is immediately stale under the
        // default `staleTime: 0`), so we cover that background GET too —
        // the test asserts no `/replan` POST, not zero fetches overall.
        mockFetch.mockResolvedValue(jsonResponse({ irrigationEnabled: false, since: 'x' }));

        const { wrapper, client } = buildApiWrapper();
        client.setQueryData(keys.system.state(), { irrigationEnabled: false, since: 'x' });

        render(<Header onMenuPress={jest.fn()} />, { wrapper });
        const refresh = screen.getByLabelText('Re-plan');
        fireEvent.press(refresh);

        const replanCalls = mockFetch.mock.calls.filter(([url]) => String(url).endsWith('/replan'));
        expect(replanCalls).toHaveLength(0);
        expect(refresh.props.accessibilityState).toMatchObject({ disabled: true });
    });

    it('keeps the refresh button disabled while a re-plan request is in flight.', async () => {
        // Hold the POST /replan promise open so the mutation stays pending
        // long enough to observe the disabled state.
        let resolveReplan: (response: Response) => void = () => {};
        const replanPromise = new Promise<Response>(resolve => {
            resolveReplan = resolve;
        });
        mockFetch.mockReturnValueOnce(replanPromise);
        mockFetch.mockResolvedValue(jsonResponse({ irrigationEnabled: true, since: 'x' }));

        const { wrapper, client } = buildApiWrapper();
        client.setQueryData(keys.system.state(), { irrigationEnabled: true, since: 'x' });

        render(<Header onMenuPress={jest.fn()} />, { wrapper });
        fireEvent.press(screen.getByLabelText('Re-plan'));

        await waitFor(() => {
            expect(screen.getByLabelText('Re-plan').props.accessibilityState).toMatchObject({ disabled: true });
        });

        // Release the held promise so the mutation settles and React Query
        // doesn't log "unhandled promise" warnings after the test ends.
        await act(async () => {
            resolveReplan(jsonResponse({ status: 'replanned', lastRePlanAt: 'x' }));
            await replanPromise;
        });
    });

    it('treats an unresolved system query as off so both icon buttons stay disabled.', () => {
        const { wrapper } = buildApiWrapper();

        render(<Header onMenuPress={jest.fn()} />, { wrapper });

        expect(screen.getByLabelText('Open menu').props.accessibilityState).toMatchObject({ disabled: true });
        expect(screen.getByLabelText('Re-plan').props.accessibilityState).toMatchObject({ disabled: true });
    });
});
