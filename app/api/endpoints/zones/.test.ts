import { jsonResponse } from '@/api/test-helpers';
import { getZones } from '.';

const mockFetch = jest.fn();

beforeEach(() => {
    (global as { fetch: typeof fetch }).fetch = mockFetch as unknown as typeof fetch;
    mockFetch.mockReset();
    process.env.EXPO_PUBLIC_API_BASE_URL = 'http://test.local:9753';
});

describe('getZones', () => {
    it('GETs /zones and unwraps the { zones } envelope to a plain array.', async () => {
        const dto = [{ id: 'z-1', name: 'North' }];
        mockFetch.mockResolvedValueOnce(jsonResponse({ zones: dto }));

        await expect(getZones()).resolves.toEqual(dto);
        const [calledUrl] = mockFetch.mock.calls.at(-1) as [string, RequestInit];
        expect(calledUrl).toBe('http://test.local:9753/zones');
    });
});
