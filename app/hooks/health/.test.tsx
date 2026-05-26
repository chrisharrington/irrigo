import { renderHook, waitFor } from '@testing-library/react-native';

import { buildApiWrapper, jsonResponse } from '@/api/test-utils';
import { useHealth } from '.';

const mockFetch = jest.fn();

beforeEach(() => {
    (global as { fetch: typeof fetch }).fetch = mockFetch as unknown as typeof fetch;
    mockFetch.mockReset();
    process.env.EXPO_PUBLIC_API_BASE_URL = 'http://test.local:9753';
});

describe('useHealth', () => {
    it('reports success after the API returns 200 against /health.', async () => {
        mockFetch.mockResolvedValueOnce(jsonResponse({ ok: true }));

        const { result } = renderHook(() => useHealth(), { wrapper: buildApiWrapper().wrapper });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect((mockFetch.mock.calls[0] as [string])[0]).toBe('http://test.local:9753/health');
    });

    it('surfaces a transport-level ApiError when fetch rejects.', async () => {
        mockFetch.mockRejectedValueOnce(new TypeError('Network request failed'));

        const { result } = renderHook(() => useHealth(), { wrapper: buildApiWrapper().wrapper });

        await waitFor(() => expect(result.current.isError).toBe(true));
        expect(result.current.error?.status).toBe(0);
        expect(result.current.error?.code).toBe('network');
    });

    it('surfaces a server-side ApiError when the API returns a 5xx.', async () => {
        mockFetch.mockResolvedValueOnce(jsonResponse({ error: 'planner', message: 'planner crashed' }, 503));

        const { result } = renderHook(() => useHealth(), { wrapper: buildApiWrapper().wrapper });

        await waitFor(() => expect(result.current.isError).toBe(true));
        expect(result.current.error?.status).toBe(503);
    });
});
