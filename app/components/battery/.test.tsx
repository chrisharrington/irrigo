import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { Battery, computeBatteryGeometry } from '.';

describe('computeBatteryGeometry', () => {
    it('returns ok tone with the correct fill and notch percentages when depletion is well below RAW.', () => {
        // raw 25, depletion 10 → scaleMax = max(31.25, 14) = 31.25
        // pct = 10 / 31.25 = 32%, rawPct = 25 / 31.25 = 80%
        const result = computeBatteryGeometry(10, 25);

        expect(result.tone).toBe('ok');
        expect(result.scaleMax).toBeCloseTo(31.25);
        expect(result.pct).toBeCloseTo(32);
        expect(result.rawPct).toBeCloseTo(80);
    });

    it('flips to warn tone once depletion crosses 80% of RAW.', () => {
        // depletion / raw = 21 / 25 = 0.84 → warn
        const result = computeBatteryGeometry(21, 25);

        expect(result.tone).toBe('warn');
    });

    it('stays in ok tone at exactly 80% of RAW (strictly greater triggers warn).', () => {
        // depletion / raw = 20 / 25 = 0.80 → ok
        const result = computeBatteryGeometry(20, 25);

        expect(result.tone).toBe('ok');
    });

    it('flips to danger tone when depletion meets or exceeds RAW.', () => {
        expect(computeBatteryGeometry(25, 25).tone).toBe('danger');
        expect(computeBatteryGeometry(30, 25).tone).toBe('danger');
    });

    it('keeps fill width capped at 100% even when depletion would exceed the scale.', () => {
        // depletion 30, raw 25 → scaleMax = max(31.25, 34) = 34; pct = 30/34 ≈ 88.2%
        const result = computeBatteryGeometry(30, 25);

        expect(result.pct).toBeLessThanOrEqual(100);
    });

    it('handles RAW = 0 without dividing by zero; tone falls back to ok.', () => {
        const result = computeBatteryGeometry(5, 0);

        expect(result.tone).toBe('ok');
        expect(Number.isFinite(result.pct)).toBe(true);
        expect(result.rawPct).toBe(0);
    });

    it('clamps negative depletion to 0 (surplus-moisture state still pegs at the lowest tick).', () => {
        const result = computeBatteryGeometry(-3, 25);

        expect(result.pct).toBe(0);
        expect(result.tone).toBe('ok');
    });
});

describe('Battery', () => {
    it('renders a progressbar with the derived accessibility label.', () => {
        render(<Battery depletion={10} raw={25} />);

        const bar = screen.getByLabelText('ok — 10 of 25 mm');
        expect(bar).toBeOnTheScreen();
        expect(bar.props.accessibilityRole).toBe('progressbar');
    });

    it('reflects the warn tone in the derived label as depletion crosses 80% of RAW.', () => {
        render(<Battery depletion={21} raw={25} />);

        expect(screen.getByLabelText('warn — 21 of 25 mm')).toBeOnTheScreen();
    });

    it('reflects the danger tone in the derived label once depletion meets RAW.', () => {
        render(<Battery depletion={26} raw={25} />);

        expect(screen.getByLabelText('danger — 26 of 25 mm')).toBeOnTheScreen();
    });

    it('honours an explicit accessibility label override.', () => {
        render(<Battery depletion={10} raw={25} accessibilityLabel='north-soil-battery' />);

        expect(screen.getByLabelText('north-soil-battery')).toBeOnTheScreen();
    });

    it('exposes the depletion as the progressbar `now` value with `max` matching the computed scale.', () => {
        render(<Battery depletion={10} raw={25} />);

        const bar = screen.getByLabelText('ok — 10 of 25 mm');
        expect(bar.props.accessibilityValue).toEqual({ min: 0, max: 31.25, now: 10 });
    });

    it('renders the 10px-tall compact variant by default.', () => {
        render(<Battery depletion={10} raw={25} />);

        const bar = screen.getByLabelText('ok — 10 of 25 mm');
        const style = StyleSheet.flatten(bar.props.style) as { height?: number };
        expect(style.height).toBe(10);
    });

    it('renders the 16px-tall variant when `tall` is true.', () => {
        render(<Battery depletion={10} raw={25} tall />);

        const bar = screen.getByLabelText('ok — 10 of 25 mm');
        const style = StyleSheet.flatten(bar.props.style) as { height?: number };
        expect(style.height).toBe(16);
    });

    it('positions the notch at raw / scaleMax (80% for raw 25 / depletion 10).', () => {
        render(<Battery depletion={10} raw={25} />);

        const notch = screen.getByLabelText('raw-notch');
        const style = StyleSheet.flatten(notch.props.style) as { left?: string };
        expect(style.left).toBe('80%');
    });
});
