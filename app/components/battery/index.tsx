import { useEffect, useRef } from 'react';
import { Animated, View } from 'react-native';

import config from '@/tailwind.config';

const colors = config.theme.extend.colors;

const TRACK_BG = colors['ink-400'];
const TRACK_BORDER = colors.border;
const NOTCH_COLOR = colors['chalk-200'];

const TONE_COLOR = {
    ok: colors.accent,
    warn: colors.warn,
    danger: colors.danger,
} as const;

const TRANSITION_MS = 360;

export type BatteryTone = keyof typeof TONE_COLOR;

/**
 * Pure geometry helper. Mirrors the math in the source `Battery` component:
 *
 *     scaleMax = max(raw * 1.25, depletion + 4)
 *     pct      = min(100, (depletion / scaleMax) * 100)
 *     rawPct   = (raw / scaleMax) * 100
 *     tone     = depletion >= raw          ? 'danger'
 *              : depletion / raw > 0.8     ? 'warn'
 *              : 'ok'
 *
 * Guards:
 *   - `depletion` is clamped to 0 (negative depletion = surplus moisture; the
 *     visual still pegs at the lowest tick).
 *   - When `raw <= 0` the ratio test is undefined, so `tone` defaults to `ok`
 *     and the scale is driven entirely by `depletion + 4`.
 */
export function computeBatteryGeometry(
    depletion: number,
    raw: number,
): { pct: number; rawPct: number; scaleMax: number; tone: BatteryTone } {
    const safeDepletion = Math.max(0, depletion);
    const scaleMax = Math.max(raw * 1.25, safeDepletion + 4);
    const pct = scaleMax > 0 ? Math.min(100, (safeDepletion / scaleMax) * 100) : 0;
    const rawPct = scaleMax > 0 && raw > 0 ? (raw / scaleMax) * 100 : 0;

    let tone: BatteryTone = 'ok';
    if (raw > 0) {
        if (safeDepletion >= raw) tone = 'danger';
        else if (safeDepletion / raw > 0.8) tone = 'warn';
    }

    return { pct, rawPct, scaleMax, tone };
}

/**
 * Props for the Irrigo depletion battery primitive.
 */
export type BatteryProps = {
    /** Required. Current depletion in mm. Clamped to 0 if negative. */
    depletion: number;

    /** Required. RAW threshold in mm (the maximum allowable depletion for the zone). */
    raw: number;

    /** Optional. Renders the 16px-tall variant used by the Zone detail hero. Defaults to false (compact 10px). */
    tall?: boolean;

    /** Optional. Accessibility label spoken by screen readers. Defaults to a derived `"{tone} — {depletion} of {raw} mm"` string. */
    accessibilityLabel?: string;
};

/**
 * The Irrigo depletion battery — visually compares the current soil-moisture
 * depletion against the zone's RAW (readily-available water) threshold.
 * Track recolors from accent (ok) to warn (≥80% of RAW) to danger (≥ RAW) as
 * depletion approaches the limit. The notch holds steady at the RAW mark
 * while the fill grows; both width and tone tween over 360ms.
 */
export function Battery({
    depletion,
    raw,
    tall = false,
    accessibilityLabel,
}: BatteryProps) {
    const geometry = computeBatteryGeometry(depletion, raw);
    const trackHeight = tall ? 16 : 10;
    const notchOverflow = tall ? 4 : 3;

    const animated = useRef(new Animated.Value(geometry.pct / 100)).current;
    const toneAnimated = useRef(new Animated.Value(toneIndex(geometry.tone))).current;

    useEffect(() => {
        Animated.timing(animated, {
            toValue: geometry.pct / 100,
            duration: TRANSITION_MS,
            useNativeDriver: false,
        }).start();
    }, [animated, geometry.pct]);

    useEffect(() => {
        Animated.timing(toneAnimated, {
            toValue: toneIndex(geometry.tone),
            duration: TRANSITION_MS,
            useNativeDriver: false,
        }).start();
    }, [toneAnimated, geometry.tone]);

    const fillWidth = animated.interpolate({
        inputRange: [0, 1],
        outputRange: ['0%', '100%'],
    });
    const fillBackgroundColor = toneAnimated.interpolate({
        inputRange: [0, 1, 2],
        outputRange: [TONE_COLOR.ok, TONE_COLOR.warn, TONE_COLOR.danger],
    });

    const derivedLabel = accessibilityLabel
        ?? `${geometry.tone} — ${formatMm(depletion)} of ${formatMm(raw)} mm`;

    return (
        <View
            accessibilityRole='progressbar'
            accessibilityLabel={derivedLabel}
            accessibilityValue={{ min: 0, max: Math.round(geometry.scaleMax * 100) / 100, now: Math.max(0, depletion) }}
            style={{
                position: 'relative',
                width: '100%',
                height: trackHeight,
                backgroundColor: TRACK_BG,
                borderWidth: 1,
                borderColor: TRACK_BORDER,
                borderRadius: 4,
                overflow: 'hidden',
            }}
        >
            <Animated.View
                style={{
                    position: 'absolute',
                    top: 0,
                    bottom: 0,
                    left: 0,
                    width: fillWidth,
                    backgroundColor: fillBackgroundColor,
                }}
            />
            <View
                accessibilityLabel='raw-notch'
                style={{
                    position: 'absolute',
                    top: -notchOverflow,
                    bottom: -notchOverflow,
                    left: `${geometry.rawPct}%`,
                    width: 2,
                    backgroundColor: NOTCH_COLOR,
                    opacity: 0.8,
                    borderRadius: 4,
                }}
            />
        </View>
    );
}

function toneIndex(tone: BatteryTone): number {
    if (tone === 'ok') return 0;
    if (tone === 'warn') return 1;
    return 2;
}

function formatMm(value: number): string {
    return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1);
}
