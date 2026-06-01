import { act, renderHook } from '@testing-library/react-native';

import { useNow } from '.';

describe('useNow', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2026-05-23T09:00:00.000Z'));
    });

    afterEach(() => {
        // Cancel the hook's interval without firing it (firing after the test
        // would set state outside act()).
        jest.clearAllTimers();
        jest.useRealTimers();
    });

    it('refreshes the returned instant on each interval tick.', () => {
        const { result } = renderHook(() => useNow(60_000));
        const first = result.current.getTime();
        expect(first).toBe(new Date('2026-05-23T09:00:00.000Z').getTime());

        // Advancing the fake timers also advances the faked `Date`, so the
        // interval callback re-reads the clock one minute on.
        act(() => {
            jest.advanceTimersByTime(60_000);
        });

        expect(result.current.getTime()).toBe(new Date('2026-05-23T09:01:00.000Z').getTime());
        expect(result.current.getTime()).toBeGreaterThan(first);
    });

    it('stays frozen when intervalMs is null (no timer spun up).', () => {
        const { result } = renderHook(() => useNow(null));
        const first = result.current;

        act(() => {
            jest.advanceTimersByTime(60 * 60_000);
        });

        // No interval was scheduled, so the value is the same instance.
        expect(result.current).toBe(first);
    });
});
