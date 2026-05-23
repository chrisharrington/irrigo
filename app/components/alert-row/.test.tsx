import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { AlertRow, type AlertRowTone } from '.';

type FlatStyle = {
    backgroundColor?: string;
    borderColor?: string;
    color?: string;
};

const TONE_EXPECTATIONS: Readonly<Record<AlertRowTone, { border: string; accent: string; icon: string }>> = {
    info: { border: 'rgba(124, 212, 251, 0.4)', accent: '#7CD4FB', icon: 'i' },
    warn: { border: 'rgba(255, 190, 107, 0.4)', accent: '#FFBE6B', icon: '⚠' },
    danger: { border: 'rgba(255, 107, 123, 0.4)', accent: '#FF6B7B', icon: '!' },
};

describe('AlertRow', () => {
    it('renders the title.', () => {
        render(<AlertRow tone='danger' title='HA close failed' />);

        expect(screen.getByText('HA close failed')).toBeOnTheScreen();
    });

    it('renders the sub-line when provided.', () => {
        render(
            <AlertRow
                tone='danger'
                title='HA close failed'
                sub='Last attempt failed: 502 Bad Gateway.'
            />,
        );

        expect(screen.getByText('Last attempt failed: 502 Bad Gateway.')).toBeOnTheScreen();
    });

    it('hides the sub-line when omitted.', () => {
        render(<AlertRow tone='danger' title='HA close failed' />);

        // No sub text node — only title + icon glyph + (no when).
        expect(screen.queryByText('Last attempt failed: 502 Bad Gateway.')).toBeNull();
    });

    it('renders the relative-time slot when provided.', () => {
        render(<AlertRow tone='warn' title='Weather API stale' when='11h' />);

        expect(screen.getByText('11h')).toBeOnTheScreen();
    });

    it('omits the relative-time slot when not provided.', () => {
        render(<AlertRow tone='warn' title='Weather API stale' />);

        expect(screen.queryByText('11h')).toBeNull();
    });

    it.each(Object.entries(TONE_EXPECTATIONS) as ReadonlyArray<[AlertRowTone, { border: string; accent: string; icon: string }]>)(
        'paints the %s tone palette on the container border and title color.',
        (tone, expected) => {
            const { root } = render(<AlertRow tone={tone} title='Test alert' />);

            const containerStyle = StyleSheet.flatten(root.props.style) as FlatStyle;
            expect(containerStyle.borderColor).toBe(expected.border);

            const titleStyle = StyleSheet.flatten(screen.getByText('Test alert').props.style) as FlatStyle;
            expect(titleStyle.color).toBe(expected.accent);
        },
    );

    it.each(Object.entries(TONE_EXPECTATIONS) as ReadonlyArray<[AlertRowTone, { border: string; accent: string; icon: string }]>)(
        'renders the %s icon glyph.',
        (tone, expected) => {
            render(<AlertRow tone={tone} title='Test alert' />);

            expect(screen.getByText(expected.icon)).toBeOnTheScreen();
        },
    );

    it('builds a default accessibility label combining title and sub.', () => {
        render(
            <AlertRow
                tone='danger'
                title='HA close failed'
                sub='Last attempt failed: 502 Bad Gateway.'
            />,
        );

        expect(
            screen.getByLabelText('HA close failed. Last attempt failed: 502 Bad Gateway.'),
        ).toBeOnTheScreen();
    });

    it('uses the title alone as the default accessibility label when no sub is provided.', () => {
        render(<AlertRow tone='warn' title='Weather API stale' />);

        expect(screen.getByLabelText('Weather API stale')).toBeOnTheScreen();
    });

    it('honors a caller-provided accessibility label, overriding the default.', () => {
        render(
            <AlertRow
                tone='danger'
                title='HA close failed'
                sub='502 Bad Gateway'
                accessibilityLabel='Alert: zone South close failed earlier tonight'
            />,
        );

        expect(
            screen.getByLabelText('Alert: zone South close failed earlier tonight'),
        ).toBeOnTheScreen();
    });
});
