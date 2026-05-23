import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

jest.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 44, bottom: 0, left: 0, right: 0 }),
}));

import { PushBanner } from '.';

describe('PushBanner', () => {
    beforeEach(() => {
        jest.useFakeTimers();
    });

    afterEach(() => {
        act(() => {
            jest.runOnlyPendingTimers();
        });
        jest.useRealTimers();
    });

    it('renders nothing when visible is false.', () => {
        render(
            <PushBanner
                visible={false}
                tone='danger'
                title='HA close failed'
                onDismiss={() => {}}
            />,
        );

        expect(screen.queryByText('HA close failed')).toBeNull();
    });

    it('renders the title and sub when visible.', () => {
        render(
            <PushBanner
                visible
                tone='danger'
                title='HA close failed'
                sub='Last attempt failed: 502 Bad Gateway.'
                onDismiss={() => {}}
            />,
        );

        expect(screen.getByText('HA close failed')).toBeOnTheScreen();
        expect(screen.getByText('Last attempt failed: 502 Bad Gateway.')).toBeOnTheScreen();
    });

    it('fires `onPress` when the banner is tapped.', () => {
        const onPress = jest.fn();
        render(
            <PushBanner
                visible
                tone='warn'
                title='Weather API stale'
                onPress={onPress}
                onDismiss={() => {}}
            />,
        );

        fireEvent.press(screen.getByLabelText('Notification: Weather API stale'));

        expect(onPress).toHaveBeenCalledTimes(1);
    });

    it('auto-dismisses after the 6-second timer fires.', () => {
        const onDismiss = jest.fn();
        render(
            <PushBanner
                visible
                tone='info'
                title='System reconnected'
                onDismiss={onDismiss}
            />,
        );

        // Just before the 6s mark, no auto-dismiss yet.
        act(() => {
            jest.advanceTimersByTime(5999);
        });
        expect(onDismiss).not.toHaveBeenCalled();

        // Tick across the 6s mark — dismiss fires.
        act(() => {
            jest.advanceTimersByTime(1);
        });
        expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    it('cancels the auto-dismiss timer when visibility flips back to false.', () => {
        const onDismiss = jest.fn();
        const { rerender } = render(
            <PushBanner
                visible
                tone='info'
                title='System reconnected'
                onDismiss={onDismiss}
            />,
        );

        rerender(
            <PushBanner
                visible={false}
                tone='info'
                title='System reconnected'
                onDismiss={onDismiss}
            />,
        );

        act(() => {
            jest.advanceTimersByTime(10000);
        });

        // The timer was cleared on the visibility flip — onDismiss should
        // not fire from the auto-dismiss path.
        expect(onDismiss).not.toHaveBeenCalled();
    });

    it('positions the banner below the safe-area top inset.', () => {
        const { root } = render(
            <PushBanner
                visible
                tone='danger'
                title='Test'
                onDismiss={() => {}}
            />,
        );

        // The safe-area inset is mocked at 44; the banner wrap places `top`
        // at `inset.top + 8` → 52.
        const wrap = root.find(node => {
            if (typeof node.type !== 'string') return false;
            const flat = StyleSheet.flatten(node.props.style as Parameters<typeof StyleSheet.flatten>[0]) as
                | { position?: string; top?: number }
                | undefined;
            return flat?.position === 'absolute';
        });
        const flat = StyleSheet.flatten(wrap.props.style as Parameters<typeof StyleSheet.flatten>[0]) as { top?: number };
        expect(flat.top).toBe(52);
    });
});
