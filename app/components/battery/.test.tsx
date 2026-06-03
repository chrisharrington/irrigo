import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { Battery, computeBatteryGeometry } from '.';

describe('computeBatteryGeometry', () => {
    it('returns a full bar (100%) when depletion is 0 — the bucket is at capacity.', () => {
        // raw 25, depletion 0 → scaleMax = max(31.25, 4) = 31.25
        // fillPct = (31.25 - 0) / 31.25 = 100%, notchPct = 6.25 / 31.25 = 20%
        const result = computeBatteryGeometry(0, 25);

        expect(result.tone).toBe('ok');
        expect(result.scaleMax).toBeCloseTo(31.25);
        expect(result.fillPct).toBeCloseTo(100);
        expect(result.notchPct).toBeCloseTo(20);
    });

    it('shrinks the fill as depletion grows (bucket drains).', () => {
        // raw 25, depletion 10 → scaleMax = 31.25
        // fillPct = (31.25 - 10) / 31.25 = 68%, notchPct = 20%
        const result = computeBatteryGeometry(10, 25);

        expect(result.tone).toBe('ok');
        expect(result.fillPct).toBeCloseTo(68);
        expect(result.notchPct).toBeCloseTo(20);
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

    it('flips to danger tone when depletion meets or exceeds RAW (bucket empty).', () => {
        expect(computeBatteryGeometry(25, 25).tone).toBe('danger');
        expect(computeBatteryGeometry(30, 25).tone).toBe('danger');
    });

    it('keeps the fill from going negative even when depletion exceeds the scale.', () => {
        // depletion 30, raw 25 → scaleMax = max(31.25, 34) = 34; fillPct = 4/34 ≈ 11.8%
        const result = computeBatteryGeometry(30, 25);

        expect(result.fillPct).toBeGreaterThanOrEqual(0);
        expect(result.fillPct).toBeCloseTo(11.76, 1);
    });

    it('places the notch where the receding fill meets the irrigation trigger (depletion === raw).', () => {
        // raw 25, depletion 25 → scaleMax = max(31.25, 29) = 31.25
        // notchPct = (31.25 - 25) / 31.25 = 20%; fillPct = 20% — they coincide.
        const result = computeBatteryGeometry(25, 25);

        expect(result.fillPct).toBeCloseTo(20);
        expect(result.notchPct).toBeCloseTo(20);
    });

    it('handles RAW = 0 without dividing by zero; tone falls back to ok and the notch collapses.', () => {
        const result = computeBatteryGeometry(5, 0);

        expect(result.tone).toBe('ok');
        expect(Number.isFinite(result.fillPct)).toBe(true);
        expect(result.notchPct).toBe(0);
    });

    it('clamps negative depletion to 0 (surplus moisture still shows a full bar).', () => {
        const result = computeBatteryGeometry(-3, 25);

        expect(result.fillPct).toBeCloseTo(100);
        expect(result.tone).toBe('ok');
    });
});

describe('Battery', () => {
    it('renders a progressbar with the derived water-held accessibility label.', () => {
        render(<Battery depletion={10} raw={25} />);

        const bar = screen.getByLabelText('ok — 15 of 25 mm available');
        expect(bar).toBeOnTheScreen();
        expect(bar.props.accessibilityRole).toBe('progressbar');
    });

    it('reflects the warn tone in the derived label as depletion crosses 80% of RAW.', () => {
        render(<Battery depletion={21} raw={25} />);

        expect(screen.getByLabelText('warn — 4 of 25 mm available')).toBeOnTheScreen();
    });

    it('reflects the danger tone and a drained bucket once depletion meets RAW.', () => {
        render(<Battery depletion={26} raw={25} />);

        expect(screen.getByLabelText('danger — 0 of 25 mm available')).toBeOnTheScreen();
    });

    it('honours an explicit accessibility label override.', () => {
        render(<Battery depletion={10} raw={25} accessibilityLabel='north-soil-battery' />);

        expect(screen.getByLabelText('north-soil-battery')).toBeOnTheScreen();
    });

    it('exposes the held water as the progressbar `now` value with `max` matching RAW capacity.', () => {
        render(<Battery depletion={10} raw={25} />);

        const bar = screen.getByLabelText('ok — 15 of 25 mm available');
        expect(bar.props.accessibilityValue).toEqual({ min: 0, max: 25, now: 15 });
    });

    it('renders the 10px-tall compact variant by default.', () => {
        render(<Battery depletion={10} raw={25} />);

        const bar = screen.getByLabelText('ok — 15 of 25 mm available');
        const style = StyleSheet.flatten(bar.props.style) as { height?: number };
        expect(style.height).toBe(10);
    });

    it('renders the 16px-tall variant when `tall` is true.', () => {
        render(<Battery depletion={10} raw={25} tall />);

        const bar = screen.getByLabelText('ok — 15 of 25 mm available');
        const style = StyleSheet.flatten(bar.props.style) as { height?: number };
        expect(style.height).toBe(16);
    });

    it('positions the notch at (scaleMax - raw) / scaleMax (20% for raw 25 / depletion 10).', () => {
        render(<Battery depletion={10} raw={25} />);

        const notch = screen.getByLabelText('raw-notch');
        const style = StyleSheet.flatten(notch.props.style) as { left?: string };
        expect(style.left).toBe('20%');
    });
});
