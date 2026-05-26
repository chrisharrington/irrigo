import { fireEvent, render, screen } from '@testing-library/react-native';

import type { AlertDto } from '@/api/types/alerts';
import { buildApiWrapper, jsonResponse } from '@/api/test-utils';
import { keys } from '@/api/query-keys';
import config from '@/tailwind.config';
import { Header } from '.';

const colors = config.theme.extend.colors;
const mockFetch = jest.fn();

beforeEach(() => {
    (global as { fetch: typeof fetch }).fetch = mockFetch as unknown as typeof fetch;
    mockFetch.mockReset();
    process.env.EXPO_PUBLIC_API_BASE_URL = 'http://test.local:9753';
});

function buildAlert(overrides?: Partial<AlertDto>): AlertDto {
    return {
        id: 'a-1',
        class: 'weather-stale',
        tone: 'warn',
        title: 'Weather API stale',
        sub: null,
        when: '2026-05-24T11:00:00.000Z',
        zoneId: null,
        ack: false,
        ...overrides,
    };
}

function seedSystem(client: ReturnType<typeof buildApiWrapper>['client'], irrigationOn: boolean) {
    client.setQueryData(keys.system.state(), { irrigationEnabled: irrigationOn, since: 'x' });
}

function seedAlerts(client: ReturnType<typeof buildApiWrapper>['client'], alerts: ReadonlyArray<AlertDto>) {
    client.setQueryData(keys.alerts.list(), alerts);
}

describe('Header', () => {
    it('renders menu, brand, and bell — refresh is no longer in the tree (APP-62).', () => {
        const { wrapper, client } = buildApiWrapper();
        seedSystem(client, true);
        seedAlerts(client, []);

        render(<Header onMenuPress={jest.fn()} onAlertsPress={jest.fn()} />, { wrapper });

        expect(screen.getByLabelText('Open menu')).toBeOnTheScreen();
        expect(screen.getByLabelText('Irrigo')).toBeOnTheScreen();
        expect(screen.getByText('Irrigo')).toBeOnTheScreen();
        expect(screen.getByLabelText('Alerts, no unread')).toBeOnTheScreen();
        expect(screen.queryByLabelText('Re-plan')).toBeNull();
    });

    it('calls onMenuPress when the user taps the menu button while irrigation is on.', () => {
        const onMenuPress = jest.fn();
        const { wrapper, client } = buildApiWrapper();
        seedSystem(client, true);
        seedAlerts(client, []);

        render(<Header onMenuPress={onMenuPress} onAlertsPress={jest.fn()} />, { wrapper });
        fireEvent.press(screen.getByLabelText('Open menu'));

        expect(onMenuPress).toHaveBeenCalledTimes(1);
    });

    it('disables the menu button and ignores presses when irrigation is off.', () => {
        const onMenuPress = jest.fn();
        const { wrapper, client } = buildApiWrapper();
        seedSystem(client, false);
        seedAlerts(client, []);

        render(<Header onMenuPress={onMenuPress} onAlertsPress={jest.fn()} />, { wrapper });
        const menu = screen.getByLabelText('Open menu');
        fireEvent.press(menu);

        expect(onMenuPress).not.toHaveBeenCalled();
        expect(menu.props.accessibilityState).toMatchObject({ disabled: true });
    });

    it('shows no badge text when the alerts cache is empty (APP-62).', () => {
        const { wrapper, client } = buildApiWrapper();
        seedSystem(client, true);
        seedAlerts(client, []);

        render(<Header onMenuPress={jest.fn()} onAlertsPress={jest.fn()} />, { wrapper });

        expect(screen.getByLabelText('Alerts, no unread')).toBeOnTheScreen();
        // No digit text rendered for 0.
        expect(screen.queryByText(/^\d+$/)).toBeNull();
        expect(screen.queryByText('9+')).toBeNull();
    });

    it('renders an integer badge with the accent tone for info-only unacked alerts (APP-62).', () => {
        const { wrapper, client } = buildApiWrapper();
        seedSystem(client, true);
        // The wire type only allows tone "warn" | "danger"; "info" isn't in
        // the union. The fallback severity ('info' → accent colour) is
        // exercised when the alerts array is non-empty AND has no warn /
        // danger entries — practically that means the cache holds zero
        // items but `useAlerts` data is treated as "unknown tone". Cover
        // that path by injecting a synthetic entry shaped like an AlertDto
        // with a non-warn/non-danger tone via a cast.
        const accentAlerts = [
            buildAlert({ id: 'a-1', tone: 'warn' as never }),
            buildAlert({ id: 'a-2', tone: 'warn' as never }),
            buildAlert({ id: 'a-3', tone: 'warn' as never }),
        ];
        // Replace the warn tone with a "neutral" string the highest-
        // severity helper falls through on. Cast back to AlertDto[] so the
        // cache write typechecks.
        const neutralAlerts = accentAlerts.map(a => ({ ...a, tone: 'neutral' as unknown as 'warn' }));
        seedAlerts(client, neutralAlerts as AlertDto[]);

        render(<Header onMenuPress={jest.fn()} onAlertsPress={jest.fn()} />, { wrapper });

        expect(screen.getByLabelText('Alerts, 3 unread')).toBeOnTheScreen();
        expect(screen.getByText('3')).toBeOnTheScreen();
        const badge = screen.getByLabelText('Unread count 3');
        expect(badge.props.style).toEqual(
            expect.arrayContaining([expect.objectContaining({ backgroundColor: colors.accent })]),
        );
    });

    it('caps the badge text at "9+" when there are more than nine unacked alerts (APP-62).', () => {
        const { wrapper, client } = buildApiWrapper();
        seedSystem(client, true);
        seedAlerts(client, Array.from({ length: 12 }, (_, i) => buildAlert({ id: `a-${i}` })));

        render(<Header onMenuPress={jest.fn()} onAlertsPress={jest.fn()} />, { wrapper });

        expect(screen.getByText('9+')).toBeOnTheScreen();
        expect(screen.getByLabelText('Alerts, 12 unread')).toBeOnTheScreen();
    });

    it('uses the warn tint when at least one unacked alert is warn-tone (APP-62).', () => {
        const { wrapper, client } = buildApiWrapper();
        seedSystem(client, true);
        seedAlerts(client, [
            buildAlert({ id: 'a-1', tone: 'warn' }),
            buildAlert({ id: 'a-2', tone: 'warn' }),
        ]);

        render(<Header onMenuPress={jest.fn()} onAlertsPress={jest.fn()} />, { wrapper });

        const badge = screen.getByLabelText('Unread count 2');
        expect(badge.props.style).toEqual(
            expect.arrayContaining([expect.objectContaining({ backgroundColor: colors.warn })]),
        );
    });

    it('uses the danger tint when any unacked alert is danger-tone, regardless of others (APP-62).', () => {
        const { wrapper, client } = buildApiWrapper();
        seedSystem(client, true);
        seedAlerts(client, [
            buildAlert({ id: 'a-1', tone: 'warn' }),
            buildAlert({ id: 'a-2', tone: 'danger' }),
            buildAlert({ id: 'a-3', tone: 'warn' }),
        ]);

        render(<Header onMenuPress={jest.fn()} onAlertsPress={jest.fn()} />, { wrapper });

        const badge = screen.getByLabelText('Unread count 3');
        expect(badge.props.style).toEqual(
            expect.arrayContaining([expect.objectContaining({ backgroundColor: colors.danger })]),
        );
    });

    it('fires onAlertsPress when the user taps the bell while irrigation is on (APP-62).', () => {
        const onAlertsPress = jest.fn();
        const { wrapper, client } = buildApiWrapper();
        seedSystem(client, true);
        seedAlerts(client, [buildAlert()]);

        render(<Header onMenuPress={jest.fn()} onAlertsPress={onAlertsPress} />, { wrapper });
        fireEvent.press(screen.getByLabelText('Alerts, 1 unread'));

        expect(onAlertsPress).toHaveBeenCalledTimes(1);
    });

    it('disables the bell and does not fire onAlertsPress when irrigation is off (APP-62).', () => {
        // Stub the fetch the disabled-system render still triggers (useAlerts
        // polls), so React Query doesn't hit an undefined response object.
        mockFetch.mockResolvedValue(jsonResponse([]));

        const onAlertsPress = jest.fn();
        const { wrapper, client } = buildApiWrapper();
        seedSystem(client, false);
        seedAlerts(client, []);

        render(<Header onMenuPress={jest.fn()} onAlertsPress={onAlertsPress} />, { wrapper });
        const bell = screen.getByLabelText('Alerts, no unread');
        fireEvent.press(bell);

        expect(onAlertsPress).not.toHaveBeenCalled();
        expect(bell.props.accessibilityState).toMatchObject({ disabled: true });
    });

    it('treats an unresolved system query as off so both icon buttons stay disabled (APP-62).', () => {
        const { wrapper } = buildApiWrapper();

        render(<Header onMenuPress={jest.fn()} onAlertsPress={jest.fn()} />, { wrapper });

        expect(screen.getByLabelText('Open menu').props.accessibilityState).toMatchObject({ disabled: true });
        expect(screen.getByLabelText('Alerts, no unread').props.accessibilityState).toMatchObject({ disabled: true });
    });
});
