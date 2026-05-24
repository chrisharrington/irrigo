import { renderHook, waitFor } from '@testing-library/react-native';
import { buildApiWrapper, jsonResponse } from '@/api/test-utils';
import { useNextRun } from '.';

const mockFetch = jest.fn();

beforeEach(() => {
    (global as { fetch: typeof fetch }).fetch = mockFetch as unknown as typeof fetch;
    mockFetch.mockReset();
    process.env.EXPO_PUBLIC_API_BASE_URL = 'http://test.local:9753';
});

describe('useNextRun', () => {
    it('fetches /tonight and exposes the summary state.', async () => {
        mockFetch.mockResolvedValueOnce(jsonResponse({
            state: 'idle',
            startTime: null,
            endsAt: null,
            axisStart: null,
            axisEnd: null,
            sunset: null,
            sunrise: null,
            zoneOrder: [],
            totalCycles: 0,
            zones: [],
        }));

        const { result } = renderHook(() => useNextRun(), { wrapper: buildApiWrapper().wrapper });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.data?.state).toBe('idle');
    });
});
