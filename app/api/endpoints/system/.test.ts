import { jsonResponse } from '@/api/test-helpers';
import { disableSystem, enableSystem, getSystem } from '.';

const mockFetch = jest.fn();

beforeEach(() => {
    (global as { fetch: typeof fetch }).fetch = mockFetch as unknown as typeof fetch;
    mockFetch.mockReset();
    process.env.EXPO_PUBLIC_API_BASE_URL = 'http://test.local:9753';
});

function lastCall(): { url: string; init: RequestInit } {
    const [url, init] = mockFetch.mock.calls.at(-1) as [string, RequestInit];
    return { url, init };
}

describe('getSystem', () => {
    it('GETs /system and returns the DTO unchanged.', async () => {
        const dto = { irrigationEnabled: true, since: '2026-05-22T00:00:00.000Z' };
        mockFetch.mockResolvedValueOnce(jsonResponse(dto));

        await expect(getSystem()).resolves.toEqual(dto);
        expect(lastCall().url).toBe('http://test.local:9753/system');
    });
});

describe('enableSystem', () => {
    it('POSTs /system/enable and returns the post-flip DTO.', async () => {
        const dto = { irrigationEnabled: true, since: '2026-05-22T01:00:00.000Z' };
        mockFetch.mockResolvedValueOnce(jsonResponse(dto));

        await expect(enableSystem()).resolves.toEqual(dto);
        const { url, init } = lastCall();
        expect(url).toBe('http://test.local:9753/system/enable');
        expect(init.method).toBe('POST');
    });
});

describe('disableSystem', () => {
    it('POSTs /system/disable.', async () => {
        const dto = { irrigationEnabled: false, since: '2026-05-22T01:30:00.000Z' };
        mockFetch.mockResolvedValueOnce(jsonResponse(dto));

        await disableSystem();
        const { url, init } = lastCall();
        expect(url).toBe('http://test.local:9753/system/disable');
        expect(init.method).toBe('POST');
    });
});
