import { jsonResponse } from '@/api/test-helpers';
import { ackAlert, getAlerts } from '.';

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

describe('getAlerts', () => {
    it('GETs /alerts and unwraps the { alerts } envelope.', async () => {
        const dto = [{ id: 'a-1', class: 'ha-call-failed', tone: 'danger', title: 't', sub: null, when: 'now', zoneId: null, ack: false }];
        mockFetch.mockResolvedValueOnce(jsonResponse({ alerts: dto }));

        await expect(getAlerts()).resolves.toEqual(dto);
        expect(lastCall().url).toBe('http://test.local:9753/alerts');
    });
});

describe('ackAlert', () => {
    it('POSTs to /alerts/:id/ack and returns the status discriminator.', async () => {
        mockFetch.mockResolvedValueOnce(jsonResponse({ status: 'acked' }));

        await expect(ackAlert('a-1')).resolves.toBe('acked');
        const { url, init } = lastCall();
        expect(url).toBe('http://test.local:9753/alerts/a-1/ack');
        expect(init.method).toBe('POST');
    });

    it('returns the already-acked status when the api reports an idempotent retry.', async () => {
        mockFetch.mockResolvedValueOnce(jsonResponse({ status: 'already-acked' }));

        await expect(ackAlert('a-1')).resolves.toBe('already-acked');
    });
});
