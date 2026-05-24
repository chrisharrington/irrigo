import { render, screen, waitFor } from '@testing-library/react-native';
import { StyleSheet, type ViewStyle } from 'react-native';

import { buildApiWrapper, jsonResponse } from '@/api/test-utils';
import { keys } from '@/api/query-keys';
import type { AlertDto } from '@/api/types/alerts';
import config from '@/tailwind.config';
import { AlertRegion } from '.';

const colors = config.theme.extend.colors;
const REF_NOW = new Date('2026-05-24T12:00:00.000Z');

const mockFetch = jest.fn();

beforeEach(() => {
    (global as { fetch: typeof fetch }).fetch = mockFetch as unknown as typeof fetch;
    mockFetch.mockReset();
    process.env.EXPO_PUBLIC_API_BASE_URL = 'http://test.local:9753';
});

function buildAlert(overrides?: Partial<AlertDto>): AlertDto {
    return {
        id: 'a-1',
        class: 'ha-call-failed',
        tone: 'danger',
        title: 'HA close failed',
        sub: 'North · ECONNREFUSED',
        when: '2026-05-24T10:00:00.000Z', // 2 h before REF_NOW
        zoneId: null,
        ack: false,
        ...overrides,
    };
}

describe('AlertRegion', () => {
    it('renders nothing when the alerts list is empty.', () => {
        const { wrapper, client } = buildApiWrapper();
        client.setQueryData(keys.alerts.list(), []);

        const { toJSON } = render(<AlertRegion now={REF_NOW} />, { wrapper });

        expect(toJSON()).toBeNull();
    });

    it('renders one row per active alert when the list is non-empty.', () => {
        const { wrapper, client } = buildApiWrapper();
        client.setQueryData(keys.alerts.list(), [
            buildAlert({ id: 'a-1', title: 'Weather API stale', tone: 'warn', class: 'weather-stale' }),
            buildAlert({ id: 'a-2', title: 'HA close failed' }),
        ]);

        render(<AlertRegion now={REF_NOW} />, { wrapper });

        expect(screen.getByText('Weather API stale')).toBeOnTheScreen();
        expect(screen.getByText('HA close failed')).toBeOnTheScreen();
    });

    it('filters to zone-scoped alerts when `zoneId` is supplied.', () => {
        const { wrapper, client } = buildApiWrapper();
        client.setQueryData(keys.alerts.list(), [
            buildAlert({ id: 'global', title: 'Weather API stale', tone: 'warn', zoneId: null }),
            buildAlert({ id: 'match', title: 'North relay failed', zoneId: 'zone-A' }),
            buildAlert({ id: 'mismatch', title: 'East relay failed', zoneId: 'zone-B' }),
        ]);

        render(<AlertRegion zoneId='zone-A' now={REF_NOW} />, { wrapper });

        expect(screen.getByText('North relay failed')).toBeOnTheScreen();
        expect(screen.queryByText('Weather API stale')).toBeNull();
        expect(screen.queryByText('East relay failed')).toBeNull();
    });

    it('shows global + zone-scoped alerts together when `zoneId` is omitted.', () => {
        const { wrapper, client } = buildApiWrapper();
        client.setQueryData(keys.alerts.list(), [
            buildAlert({ id: 'global', title: 'Weather API stale', tone: 'warn', zoneId: null }),
            buildAlert({ id: 'zoneA', title: 'North relay failed', zoneId: 'zone-A' }),
            buildAlert({ id: 'zoneB', title: 'East relay failed', zoneId: 'zone-B' }),
        ]);

        render(<AlertRegion now={REF_NOW} />, { wrapper });

        expect(screen.getByText('Weather API stale')).toBeOnTheScreen();
        expect(screen.getByText('North relay failed')).toBeOnTheScreen();
        expect(screen.getByText('East relay failed')).toBeOnTheScreen();
    });

    it('forwards the alert tone to each row (warn-tinted vs danger-tinted borders).', () => {
        const { wrapper, client } = buildApiWrapper();
        client.setQueryData(keys.alerts.list(), [
            buildAlert({ id: 'w', tone: 'warn', title: 'Weather API stale', class: 'weather-stale' }),
            buildAlert({ id: 'd', tone: 'danger', title: 'HA close failed' }),
        ]);

        render(<AlertRegion now={REF_NOW} />, { wrapper });

        const warnRow = screen.getByLabelText('Weather API stale. North · ECONNREFUSED');
        const dangerRow = screen.getByLabelText('HA close failed. North · ECONNREFUSED');
        const warnStyle = StyleSheet.flatten(warnRow.props.style) as ViewStyle;
        const dangerStyle = StyleSheet.flatten(dangerRow.props.style) as ViewStyle;

        expect(warnStyle.borderColor).toBe(colors['warn-border']);
        expect(dangerStyle.borderColor).toBe(colors['danger-border']);
    });

    it('omits the sub-line when the alert has no sub text.', () => {
        const { wrapper, client } = buildApiWrapper();
        client.setQueryData(keys.alerts.list(), [
            buildAlert({ id: 'plain', title: 'Weather API stale', sub: null }),
        ]);

        render(<AlertRegion now={REF_NOW} />, { wrapper });

        expect(screen.getByText('Weather API stale')).toBeOnTheScreen();
        // The original default sub from buildAlert must not leak through —
        // a null `sub` should mean no second line renders at all.
        expect(screen.queryByText('North · ECONNREFUSED')).toBeNull();
    });

    it('renders the formatted relative-time label on each row.', () => {
        const { wrapper, client } = buildApiWrapper();
        client.setQueryData(keys.alerts.list(), [
            buildAlert({ when: '2026-05-24T10:00:00.000Z' }), // 2 h before REF_NOW
        ]);

        render(<AlertRegion now={REF_NOW} />, { wrapper });

        expect(screen.getByText('2h')).toBeOnTheScreen();
    });

    it('treats loading state as empty (region collapses).', () => {
        // No seed, no fetch resolution — query stays in loading state because
        // buildApiWrapper disables retries.
        const { wrapper } = buildApiWrapper();
        mockFetch.mockImplementation(() => new Promise(() => {})); // never resolves

        const { toJSON } = render(<AlertRegion now={REF_NOW} />, { wrapper });

        expect(toJSON()).toBeNull();
    });

    it('treats error state as empty and logs the failure.', async () => {
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
        mockFetch.mockResolvedValueOnce(jsonResponse({ message: 'boom' }, 500));

        const { wrapper } = buildApiWrapper();
        const { toJSON } = render(<AlertRegion now={REF_NOW} />, { wrapper });

        await waitFor(() => expect(warnSpy).toHaveBeenCalled());
        expect(toJSON()).toBeNull();
        expect(warnSpy.mock.calls[0]?.[0]).toMatch(/alerts: region failed to load/);

        warnSpy.mockRestore();
    });
});

