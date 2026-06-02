import { jsonResponse } from '@/api/test-helpers';
import { getNotificationSettings, patchNotificationSettings } from '.';

const mockFetch = jest.fn();

const DTO = {
    scheduleStart: true,
    scheduleEnd: true,
    wateringStart: false,
    wateringEnd: false,
    error: true,
};

beforeEach(() => {
    (global as { fetch: typeof fetch }).fetch = mockFetch as unknown as typeof fetch;
    mockFetch.mockReset();
    process.env.EXPO_PUBLIC_API_BASE_URL = 'http://test.local:9753';
});

function lastCall(): { url: string; init: RequestInit } {
    const [url, init] = mockFetch.mock.calls.at(-1) as [string, RequestInit];
    return { url, init };
}

describe('getNotificationSettings', () => {
    it('GETs /settings/notifications and returns the DTO unchanged.', async () => {
        mockFetch.mockResolvedValueOnce(jsonResponse(DTO));

        await expect(getNotificationSettings()).resolves.toEqual(DTO);
        expect(lastCall().url).toBe('http://test.local:9753/settings/notifications');
    });
});

describe('patchNotificationSettings', () => {
    it('PATCHes /settings/notifications with the partial body and returns the updated DTO.', async () => {
        const updated = { ...DTO, wateringStart: true };
        mockFetch.mockResolvedValueOnce(jsonResponse(updated));

        await expect(patchNotificationSettings({ wateringStart: true })).resolves.toEqual(updated);

        const { url, init } = lastCall();
        expect(url).toBe('http://test.local:9753/settings/notifications');
        expect(init.method).toBe('PATCH');
        expect(JSON.parse(String(init.body))).toEqual({ wateringStart: true });
    });
});
