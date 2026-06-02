import { BackHandler, StyleSheet } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { buildApiWrapper, jsonResponse } from '@/api/test-utils';
import { keys } from '@/api/query-keys';
import type { ScheduleListItem } from '@/api/types/schedules';
import { NavDrawer } from '.';

jest.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 0, bottom: 34, left: 0, right: 0 }),
}));

const mockFetch = jest.fn();

beforeEach(() => {
    (global as { fetch: typeof fetch }).fetch = mockFetch as unknown as typeof fetch;
    mockFetch.mockReset();
    process.env.EXPO_PUBLIC_API_BASE_URL = 'http://test.local:9753';
});

const SAMPLE_ACTIVE: ScheduleListItem = {
    id: 'sched-1',
    slug: 'maintenance',
    name: 'Maintenance',
    isActive: true,
    allowedDays: [3, 5, 7],
    allowedTimeWindows: [{ start: '00:00', end: '10:00' }],
    rootDepthMOverride: null,
    allowableDepletionFractionOverride: null,
    endBySunrise: null,
};

const SAMPLE_INACTIVE: ScheduleListItem = {
    id: 'sched-2',
    slug: 'overseeding',
    name: 'Overseeding',
    isActive: false,
    allowedDays: null,
    allowedTimeWindows: null,
    rootDepthMOverride: 0.05,
    allowableDepletionFractionOverride: 0.25,
    endBySunrise: null,
};

describe('NavDrawer', () => {
    it('renders the brand row, three nav items, close button, and footer when visible.', async () => {
        const { wrapper, client } = buildApiWrapper();
        client.setQueryData(keys.schedules.list(), [SAMPLE_ACTIVE, SAMPLE_INACTIVE]);

        render(
            <NavDrawer visible onClose={jest.fn()} activeId='home' onSelect={jest.fn()} />,
            { wrapper },
        );

        expect(screen.getByText('Irrigo')).toBeOnTheScreen();
        expect(screen.getByText('Calgary · 740 m²')).toBeOnTheScreen();
        expect(screen.getByLabelText('Home')).toBeOnTheScreen();
        expect(screen.queryByLabelText('Zones')).toBeNull();
        expect(screen.getByLabelText('Schedules')).toBeOnTheScreen();
        expect(screen.getByLabelText('Activity')).toBeOnTheScreen();
        expect(screen.getByLabelText('Close menu')).toBeOnTheScreen();
        await waitFor(() => expect(screen.getByText('Maintenance')).toBeOnTheScreen());
    });

    it('hides its content when visible is false.', () => {
        const { wrapper, client } = buildApiWrapper();
        client.setQueryData(keys.schedules.list(), [SAMPLE_ACTIVE]);

        render(
            <NavDrawer visible={false} onClose={jest.fn()} activeId='home' onSelect={jest.fn()} />,
            { wrapper },
        );

        // Modal is not visible — RN test renderer hides its children entirely.
        expect(screen.queryByLabelText('Home')).toBeNull();
        expect(screen.queryByText('Irrigo')).toBeNull();
    });

    it('calls onSelect with the tapped nav item id.', () => {
        const onSelect = jest.fn();
        const { wrapper, client } = buildApiWrapper();
        client.setQueryData(keys.schedules.list(), [SAMPLE_ACTIVE]);

        render(
            <NavDrawer visible onClose={jest.fn()} activeId='home' onSelect={onSelect} />,
            { wrapper },
        );
        fireEvent.press(screen.getByLabelText('Activity'));

        expect(onSelect).toHaveBeenCalledTimes(1);
        expect(onSelect).toHaveBeenCalledWith('activity');
    });

    it('also calls onClose after a nav item is selected so the drawer dismisses.', () => {
        const onSelect = jest.fn();
        const onClose = jest.fn();
        const { wrapper, client } = buildApiWrapper();
        client.setQueryData(keys.schedules.list(), [SAMPLE_ACTIVE]);

        render(
            <NavDrawer visible onClose={onClose} activeId='home' onSelect={onSelect} />,
            { wrapper },
        );
        fireEvent.press(screen.getByLabelText('Schedules'));

        expect(onSelect).toHaveBeenCalledWith('schedules');
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('calls onClose when the close button is tapped.', () => {
        const onClose = jest.fn();
        const { wrapper, client } = buildApiWrapper();
        client.setQueryData(keys.schedules.list(), [SAMPLE_ACTIVE]);

        render(
            <NavDrawer visible onClose={onClose} activeId='home' onSelect={jest.fn()} />,
            { wrapper },
        );
        fireEvent.press(screen.getByLabelText('Close menu'));

        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('marks the active item with `accessibilityState.selected: true` and leaves others false.', () => {
        const { wrapper, client } = buildApiWrapper();
        client.setQueryData(keys.schedules.list(), [SAMPLE_ACTIVE]);

        render(
            <NavDrawer visible onClose={jest.fn()} activeId='activity' onSelect={jest.fn()} />,
            { wrapper },
        );

        expect(screen.getByLabelText('Activity').props.accessibilityState).toMatchObject({ selected: true });
        expect(screen.getByLabelText('Home').props.accessibilityState).toMatchObject({ selected: false });
        expect(screen.getByLabelText('Schedules').props.accessibilityState).toMatchObject({ selected: false });
    });

    it('shows the active schedule name and formatted cadence in the footer.', async () => {
        mockFetch.mockResolvedValue(jsonResponse([SAMPLE_ACTIVE, SAMPLE_INACTIVE]));

        const { wrapper } = buildApiWrapper();

        render(
            <NavDrawer visible onClose={jest.fn()} activeId='home' onSelect={jest.fn()} />,
            { wrapper },
        );

        await waitFor(() => expect(screen.getByText('Maintenance')).toBeOnTheScreen());
        expect(screen.getByText('Wed · Fri · Sun · 00:00–10:00')).toBeOnTheScreen();
    });

    it('unmounts the modal content after the close animation completes when visible flips to false.', async () => {
        const { wrapper, client } = buildApiWrapper();
        client.setQueryData(keys.schedules.list(), [SAMPLE_ACTIVE]);

        const { rerender } = render(
            <NavDrawer visible onClose={jest.fn()} activeId='home' onSelect={jest.fn()} />,
            { wrapper },
        );
        expect(screen.getByLabelText('Home')).toBeOnTheScreen();

        rerender(
            <NavDrawer visible={false} onClose={jest.fn()} activeId='home' onSelect={jest.fn()} />,
        );

        // Slide-out is 280ms; waitFor polls until the modal unmounts. Use a
        // generous timeout so the assertion survives Jest scheduling under
        // full-suite load (1500ms had observable flakes on shared CI).
        await waitFor(() => expect(screen.queryByLabelText('Home')).toBeNull(), { timeout: 5000 });
    });

    it('"Switch profile" button calls onSelect("schedules") and onClose.', () => {
        const onSelect = jest.fn();
        const onClose = jest.fn();
        const { wrapper, client } = buildApiWrapper();
        client.setQueryData(keys.schedules.list(), [SAMPLE_ACTIVE]);

        render(
            <NavDrawer visible onClose={onClose} activeId='home' onSelect={onSelect} />,
            { wrapper },
        );
        fireEvent.press(screen.getByText('Switch profile'));

        expect(onSelect).toHaveBeenCalledWith('schedules');
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('stretches the panel from the top to the bottom of the window so its background fills the viewport.', () => {
        const { wrapper, client } = buildApiWrapper();
        client.setQueryData(keys.schedules.list(), [SAMPLE_ACTIVE]);

        render(
            <NavDrawer visible onClose={jest.fn()} activeId='home' onSelect={jest.fn()} />,
            { wrapper },
        );

        // The panel is pinned top:0 / bottom:0 within the full-height overlay,
        // so its background spans the whole window — including under the system
        // bars — rather than stopping short at the nav bar (APP-73).
        const panel = screen.getByLabelText('Navigation');
        const flat = StyleSheet.flatten(panel.props.style as Parameters<typeof StyleSheet.flatten>[0]) as
            | { top?: number; bottom?: number; paddingBottom?: number }
            | undefined;
        expect(flat?.top).toBe(0);
        expect(flat?.bottom).toBe(0);
        // The safe-area inset is mocked at 34; the panel pads its bottom by that
        // amount so the footer clears the nav bar while the background still
        // fills to the screen edge (padding sits inside the painted box).
        expect(flat?.paddingBottom).toBe(34);
    });

    it('dismisses on Android hardware back while the drawer is open.', () => {
        const onClose = jest.fn();
        const { wrapper, client } = buildApiWrapper();
        client.setQueryData(keys.schedules.list(), [SAMPLE_ACTIVE]);

        const addListener = jest.spyOn(BackHandler, 'addEventListener');
        render(
            <NavDrawer visible onClose={onClose} activeId='home' onSelect={jest.fn()} />,
            { wrapper },
        );

        const backPress = addListener.mock.calls.find(([event]) => event === 'hardwareBackPress')?.[1];
        expect(backPress).toBeDefined();

        // Simulate the hardware back press; the drawer should request dismissal
        // and swallow the event so it doesn't also pop the route.
        let handled: boolean | null | undefined;
        act(() => {
            handled = backPress?.();
        });
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(handled).toBe(true);

        addListener.mockRestore();
    });

});
