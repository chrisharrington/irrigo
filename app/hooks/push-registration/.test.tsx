import { act, renderHook } from '@testing-library/react-native';
import { buildApiWrapper, jsonResponse } from '@/api/test-utils';
import { useRegisterPushToken, useUnregisterPushToken } from '.';

const mockFetch = jest.fn();

beforeEach(() => {
    (global as { fetch: typeof fetch }).fetch = mockFetch as unknown as typeof fetch;
    mockFetch.mockReset();
    process.env.EXPO_PUBLIC_API_BASE_URL = 'http://test.local:9753';
});

describe('useRegisterPushToken', () => {
    it('POSTs /push/register with the registration body.', async () => {
        mockFetch.mockResolvedValueOnce(jsonResponse({ status: 'registered' }));

        const { result } = renderHook(() => useRegisterPushToken(), { wrapper: buildApiWrapper().wrapper });

        await act(async () => {
            await result.current.mutateAsync({ token: 'tok-1', platform: 'ios', userAgent: 'irrigo/1.0' });
        });

        const [calledUrl, init] = mockFetch.mock.calls[0] as [string, RequestInit];
        expect(calledUrl).toBe('http://test.local:9753/push/register');
        expect(init.method).toBe('POST');
        expect(JSON.parse(init.body as string)).toEqual({
            token: 'tok-1',
            platform: 'ios',
            userAgent: 'irrigo/1.0',
        });
    });
});

describe('useUnregisterPushToken', () => {
    it('POSTs /push/unregister wrapping the token in an object body.', async () => {
        mockFetch.mockResolvedValueOnce(jsonResponse({ status: 'unregistered' }));

        const { result } = renderHook(() => useUnregisterPushToken(), { wrapper: buildApiWrapper().wrapper });

        await act(async () => {
            await result.current.mutateAsync('tok-1');
        });

        const [calledUrl, init] = mockFetch.mock.calls[0] as [string, RequestInit];
        expect(calledUrl).toBe('http://test.local:9753/push/unregister');
        expect(JSON.parse(init.body as string)).toEqual({ token: 'tok-1' });
    });
});
