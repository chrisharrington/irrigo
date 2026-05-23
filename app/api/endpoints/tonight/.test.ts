import { jsonResponse } from '@/api/test-helpers';
import { getTonight } from '.';

const mockFetch = jest.fn();

beforeEach(() => {
    (global as { fetch: typeof fetch }).fetch = mockFetch as unknown as typeof fetch;
    mockFetch.mockReset();
    process.env.EXPO_PUBLIC_API_BASE_URL = 'http://test.local:9753';
});

describe('getTonight', () => {
    it('GETs /tonight and returns the DTO unchanged.', async () => {
        const dto = { state: 'idle', zones: [], totalCycles: 0 };
        mockFetch.mockResolvedValueOnce(jsonResponse(dto));

        await expect(getTonight()).resolves.toEqual(dto);
        const [calledUrl] = mockFetch.mock.calls.at(-1) as [string, RequestInit];
        expect(calledUrl).toBe('http://test.local:9753/tonight');
    });
});
