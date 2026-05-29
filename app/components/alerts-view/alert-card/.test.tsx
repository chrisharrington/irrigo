import { render, screen } from '@testing-library/react-native';
import { StyleSheet, type ViewStyle, type TextStyle } from 'react-native';

import type { AlertDto } from '@/api/types/alerts';
import config from '@/tailwind.config';
import { AlertCard } from '.';

const colors = config.theme.extend.colors;
const TZ = 'America/Edmonton';
const NOW = new Date('2026-05-29T20:30:00.000Z'); // 14:30 site-local

function buildAlert(overrides?: Partial<AlertDto>): AlertDto {
    return {
        id: 'a-1',
        class: 'ha-call-failed',
        tone: 'danger',
        title: 'Controller unreachable',
        sub: 'Home Assistant has not responded since 14:02.',
        when: '2026-05-29T20:02:00.000Z', // 14:02 site-local
        zoneId: null,
        ack: false,
        ...overrides,
    };
}

describe('AlertCard', () => {
    it('renders the title, kind tag, and site-local timestamp.', () => {
        render(<AlertCard alert={buildAlert()} now={NOW} timezone={TZ} />);

        expect(screen.getByText('Controller unreachable')).toBeOnTheScreen();
        expect(screen.getByText('CONNECTION')).toBeOnTheScreen();
        expect(screen.getByText('2:02 pm')).toBeOnTheScreen();
    });

    it('derives the kind tag from the wire class.', () => {
        render(<AlertCard alert={buildAlert({ class: 'weather-stale' })} now={NOW} timezone={TZ} />);

        expect(screen.getByText('FORECAST')).toBeOnTheScreen();
    });

    it('shows the unread dot and a brighter title for unread alerts.', () => {
        render(<AlertCard alert={buildAlert({ ack: false })} now={NOW} timezone={TZ} />);

        expect(screen.getByLabelText('Unread')).toBeOnTheScreen();
        const titleStyle = StyleSheet.flatten(
            screen.getByText('Controller unreachable').props.style,
        ) as TextStyle;
        expect(titleStyle.color).toBe(colors.fg);
    });

    it('omits the unread dot and dims the title for read alerts.', () => {
        render(<AlertCard alert={buildAlert({ ack: true })} now={NOW} timezone={TZ} />);

        expect(screen.queryByLabelText('Unread')).toBeNull();
        const titleStyle = StyleSheet.flatten(
            screen.getByText('Controller unreachable').props.style,
        ) as TextStyle;
        expect(titleStyle.color).toBe(colors['fg-soft']);
    });

    it('paints the left tone strip with the danger colour for danger alerts.', () => {
        render(<AlertCard alert={buildAlert({ tone: 'danger' })} now={NOW} timezone={TZ} />);

        const card = StyleSheet.flatten(
            screen.getByLabelText(/Controller unreachable/).props.style,
        ) as ViewStyle;
        expect(card.borderLeftColor).toBe(colors.danger);
    });

    it('paints the left tone strip with the warn colour for warn alerts.', () => {
        render(
            <AlertCard
                alert={buildAlert({ tone: 'warn', title: 'Forecast stale' })}
                now={NOW}
                timezone={TZ}
            />,
        );

        const card = StyleSheet.flatten(
            screen.getByLabelText(/Forecast stale/).props.style,
        ) as ViewStyle;
        expect(card.borderLeftColor).toBe(colors.warn);
    });

    it('tints the background only when the alert is unread.', () => {
        const { rerender } = render(
            <AlertCard alert={buildAlert({ ack: false })} now={NOW} timezone={TZ} />,
        );
        const unreadStyle = StyleSheet.flatten(
            screen.getByLabelText(/Controller unreachable/).props.style,
        ) as ViewStyle;
        expect(unreadStyle.backgroundColor).toBe('rgba(255, 107, 123, 0.06)');

        rerender(<AlertCard alert={buildAlert({ ack: true })} now={NOW} timezone={TZ} />);
        const readStyle = StyleSheet.flatten(
            screen.getByLabelText(/Controller unreachable/).props.style,
        ) as ViewStyle;
        expect(readStyle.backgroundColor).toBe(colors.surface);
    });

    it('omits the sub line when the alert has no sub text.', () => {
        render(
            <AlertCard
                alert={buildAlert({ sub: null, title: 'Controller unreachable' })}
                now={NOW}
                timezone={TZ}
            />,
        );

        expect(screen.getByText('Controller unreachable')).toBeOnTheScreen();
        expect(
            screen.queryByText('Home Assistant has not responded since 14:02.'),
        ).toBeNull();
    });
});
