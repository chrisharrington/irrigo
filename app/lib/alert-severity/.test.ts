import type { AlertDto } from '@/api/types/alerts';
import config from '@/tailwind.config';
import { SEVERITY_COLOR, highestSeverity, type AlertSeverity } from '.';

const colors = config.theme.extend.colors;

function alert(tone: 'warn' | 'danger'): AlertDto {
    return {
        id: tone,
        class: 'weather-stale',
        tone,
        title: 't',
        sub: null,
        when: '2026-05-24T11:00:00.000Z',
        zoneId: null,
        ack: false,
    };
}

describe('SEVERITY_COLOR', () => {
    it('maps each severity to the matching design token.', () => {
        const map: Record<AlertSeverity, string> = SEVERITY_COLOR;
        expect(map.danger).toBe(colors.danger);
        expect(map.warn).toBe(colors.warn);
        expect(map.info).toBe(colors.accent);
    });
});

describe('highestSeverity', () => {
    it(`returns 'info' for an empty alert list (no urgency to surface).`, () => {
        expect(highestSeverity([])).toBe('info');
    });

    it(`returns 'warn' when every alert is warn-tone.`, () => {
        expect(highestSeverity([alert('warn'), alert('warn')])).toBe('warn');
    });

    it(`returns 'danger' when any alert is danger-tone, even mixed with warn.`, () => {
        expect(highestSeverity([alert('warn'), alert('danger'), alert('warn')])).toBe('danger');
    });

    it(`prioritises danger over warn regardless of order.`, () => {
        expect(highestSeverity([alert('danger')])).toBe('danger');
        expect(highestSeverity([alert('danger'), alert('warn')])).toBe('danger');
        expect(highestSeverity([alert('warn'), alert('danger')])).toBe('danger');
    });
});
