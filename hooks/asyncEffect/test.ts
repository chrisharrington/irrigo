import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { renderHook, waitFor } from '@testing-library/react-native';
import { useAsyncEffect } from './index';

// Suppress console.error for act warnings since they're expected for async effects
beforeAll(() => {
    const originalError = console.error;
    console.error = jest.fn((...args: any[]) => {
        if (typeof args[0] === 'string' && args[0].includes('not wrapped in act')) {
            return; // Suppress act warnings - expected for async effects
        }
        originalError(...args);
    });
});

afterAll(() => {
    jest.restoreAllMocks();
});

describe('useAsyncEffect', () => {
    let mockCallback: jest.MockedFunction<() => void | Promise<void>>;

    beforeEach(() => {
        mockCallback = jest.fn();
    });

    it('should call the callback on initial render', async () => {
        renderHook(() => useAsyncEffect(mockCallback, []));

        await waitFor(() => {
            expect(mockCallback).toHaveBeenCalledTimes(1);
        });
    });

    it('should call the callback when dependencies change', async () => {
        const { rerender } = renderHook<void, { deps: any[] }>(({ deps }) => useAsyncEffect(mockCallback, deps), {
            initialProps: { deps: [1] },
        });

        await waitFor(() => {
            expect(mockCallback).toHaveBeenCalledTimes(1);
        });

        // Change dependencies
        rerender({ deps: [2] });

        await waitFor(() => {
            expect(mockCallback).toHaveBeenCalledTimes(2);
        });
    });

    it('should not call the callback when dependencies stay the same', async () => {
        const { rerender } = renderHook<void, { deps: any[] }>(({ deps }) => useAsyncEffect(mockCallback, deps), {
            initialProps: { deps: [1] },
        });

        await waitFor(() => {
            expect(mockCallback).toHaveBeenCalledTimes(1);
        });

        // Rerender with same dependencies
        rerender({ deps: [1] });

        // Wait a bit to ensure no additional calls
        await new Promise(resolve => setTimeout(resolve, 10));

        expect(mockCallback).toHaveBeenCalledTimes(1);
    });

    it('should handle async callbacks', async () => {
        const asyncCallback = jest.fn(() => new Promise<void>(resolve => setTimeout(resolve, 10)));

        renderHook(() => useAsyncEffect(asyncCallback, []));

        await waitFor(() => {
            expect(asyncCallback).toHaveBeenCalledTimes(1);
        });
    });

    it('should handle callbacks that return void', async () => {
        const voidCallback = jest.fn(() => {
            // Synchronous callback that returns void
        });

        renderHook(() => useAsyncEffect(voidCallback, []));

        await waitFor(() => {
            expect(voidCallback).toHaveBeenCalledTimes(1);
        });
    });

    it('should handle callbacks that throw errors', async () => {
        const errorCallback = jest.fn(() => {
            throw new Error('Test error');
        });

        renderHook(() => useAsyncEffect(errorCallback, []));

        await waitFor(() => {
            expect(errorCallback).toHaveBeenCalledTimes(1);
        });
    });

    it('should handle async callbacks that reject', async () => {
        const rejectCallback = jest.fn(() => Promise.reject(new Error('Async error')));

        renderHook(() => useAsyncEffect(rejectCallback, []));

        await waitFor(() => {
            expect(rejectCallback).toHaveBeenCalledTimes(1);
        });
    });

    it('should work with complex dependency arrays', async () => {
        const complexDeps = [{ id: 1 }, 'string', 123, true];

        renderHook(() => useAsyncEffect(mockCallback, complexDeps));

        await waitFor(() => {
            expect(mockCallback).toHaveBeenCalledTimes(1);
        });
    });

    it('should work with empty dependency array', async () => {
        renderHook(() => useAsyncEffect(mockCallback, []));

        await waitFor(() => {
            expect(mockCallback).toHaveBeenCalledTimes(1);
        });
    });

    it('should call callback multiple times when dependencies change multiple times', async () => {
        const { rerender } = renderHook<void, { value: string }>(({ value }) => useAsyncEffect(mockCallback, [value]), {
            initialProps: { value: 'a' },
        });

        await waitFor(() => {
            expect(mockCallback).toHaveBeenCalledTimes(1);
        });

        rerender({ value: 'b' });
        await waitFor(() => {
            expect(mockCallback).toHaveBeenCalledTimes(2);
        });

        rerender({ value: 'c' });
        await waitFor(() => {
            expect(mockCallback).toHaveBeenCalledTimes(3);
        });
    });

    it('should handle callback that modifies external state', async () => {
        let externalState = 0;
        const stateModifyingCallback = jest.fn(() => {
            externalState += 1;
        });

        renderHook(() => useAsyncEffect(stateModifyingCallback, []));

        await waitFor(() => {
            expect(stateModifyingCallback).toHaveBeenCalledTimes(1);
            expect(externalState).toBe(1);
        });
    });

    it('should work with undefined dependencies (no dependency array)', async () => {
        // Note: This tests the behavior when no dependency array is provided
        // In the current implementation, this would cause the effect to run on every render
        const { rerender } = renderHook<void, { forceRender: number }>(
            ({ forceRender }) => useAsyncEffect(mockCallback, undefined as any),
            {
                initialProps: { forceRender: 0 },
            }
        );

        await waitFor(() => {
            expect(mockCallback).toHaveBeenCalledTimes(1);
        });

        // Force a re-render
        rerender({ forceRender: 1 });

        await waitFor(() => {
            expect(mockCallback).toHaveBeenCalledTimes(2);
        });
    });

    it('should handle rapid dependency changes', async () => {
        const { rerender } = renderHook<void, { counter: number }>(
            ({ counter }) => useAsyncEffect(mockCallback, [counter]),
            {
                initialProps: { counter: 0 },
            }
        );

        // Rapidly change dependencies
        for (let i = 1; i <= 5; i++) {
            rerender({ counter: i });
        }

        await waitFor(() => {
            expect(mockCallback).toHaveBeenCalledTimes(6); // Initial + 5 changes
        });
    });

    it('should call cleanup function when component unmounts', async () => {
        const mockCleanup = jest.fn();
        const callbackWithCleanup = jest.fn(async () => {
            return mockCleanup;
        });

        const { unmount } = renderHook(() => useAsyncEffect(callbackWithCleanup, []));

        await waitFor(() => {
            expect(callbackWithCleanup).toHaveBeenCalledTimes(1);
        });

        unmount();

        expect(mockCleanup).toHaveBeenCalledTimes(1);
    });

    it('should call cleanup function when dependencies change', async () => {
        const mockCleanup = jest.fn();
        const callbackWithCleanup = jest.fn(async () => {
            return mockCleanup;
        });

        const { rerender } = renderHook<void, { deps: any[] }>(
            ({ deps }) => useAsyncEffect(callbackWithCleanup, deps),
            {
                initialProps: { deps: [1] },
            }
        );

        await waitFor(() => {
            expect(callbackWithCleanup).toHaveBeenCalledTimes(1);
        });

        // Change dependencies - should trigger cleanup of previous effect
        rerender({ deps: [2] });

        await waitFor(() => {
            expect(callbackWithCleanup).toHaveBeenCalledTimes(2);
            expect(mockCleanup).toHaveBeenCalledTimes(1);
        });
    });

    it('should handle async cleanup functions', async () => {
        const mockAsyncCleanup = jest.fn(async () => {
            await new Promise(resolve => setTimeout(resolve, 10));
        });
        const callbackWithAsyncCleanup = jest.fn(async () => {
            return mockAsyncCleanup;
        });

        const { unmount } = renderHook(() => useAsyncEffect(callbackWithAsyncCleanup, []));

        await waitFor(() => {
            expect(callbackWithAsyncCleanup).toHaveBeenCalledTimes(1);
        });

        unmount();

        expect(mockAsyncCleanup).toHaveBeenCalledTimes(1);
    });
});
