import { useEffect, useRef } from 'react';
import { Animated, View } from 'react-native';

import { Duration } from '@/constants/motion';
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

export type BatteryTone = keyof typeof TONE_COLOR;

/**
 * Pure geometry helper for the bucket-fill battery. The bar represents how
 * much water the zone's bucket *holds*: full when depletion is 0, shrinking
 * leftward as soil moisture is lost. Math:
 *
 *     scaleMax = max(raw * 1.25, depletion + 4)
 *     fillPct  = max(0, (scaleMax - depletion) / scaleMax) * 100
 *     notchPct = ((scaleMax - raw) / scaleMax) * 100
 *     tone     = depletion >= raw          ? 'danger'
 *              : depletion / raw > 0.8     ? 'warn'
 *              : 'ok'
 *
 * `fillPct` is the inverse of depletion, so the fill recedes leftward as the
 * bucket empties. `notchPct` mirrors the RAW position: the receding fill edge
 * meets the notch exactly when `depletion === raw`, marking the irrigation
 * trigger. `tone` is unchanged — it already runs ok (full) → danger (empty),
 * which is green-when-full → red-when-empty for the bucket paradigm.
 *
 * Guards:
 *   - `depletion` is clamped to 0 (negative depletion = surplus moisture; the
 *     fill still pegs at a full bar).
 *   - When `raw <= 0` the ratio test is undefined, so `tone` defaults to `ok`
 *     and the notch collapses to 0.
 */
export function computeBatteryGeometry(
    depletion: number,
    raw: number,
): { fillPct: number; notchPct: number; scaleMax: number; tone: BatteryTone } {
    const safeDepletion = Math.max(0, depletion);
    const scaleMax = Math.max(raw * 1.25, safeDepletion + 4);
    const fillPct = scaleMax > 0 ? Math.max(0, ((scaleMax - safeDepletion) / scaleMax) * 100) : 0;
    const notchPct = scaleMax > 0 && raw > 0 ? ((scaleMax - raw) / scaleMax) * 100 : 0;

    let tone: BatteryTone = 'ok';
    if (raw > 0) {
        if (safeDepletion >= raw) tone = 'danger';
        else if (safeDepletion / raw > 0.8) tone = 'warn';
    }

    return { fillPct, notchPct, scaleMax, tone };
}

/**
 * Props for the Irrigo bucket-fill battery primitive.
 */
export type BatteryProps = {
    /** Required. Current depletion in mm. Clamped to 0 if negative. */
    depletion: number;

    /** Required. RAW threshold in mm (the bucket capacity / maximum allowable depletion for the zone). */
    raw: number;

    /** Optional. Renders the 16px-tall variant used by the Zone detail hero. Defaults to false (compact 10px). */
    tall?: boolean;

    /** Optional. Accessibility label spoken by screen readers. Defaults to a derived `"{tone} — {held} of {raw} mm available"` string. */
    accessibilityLabel?: string;
};

/**
 * The Irrigo bucket-fill battery — visually represents how much water the
 * zone's bucket holds, starting full and shrinking leftward as soil moisture
 * is lost. Track recolors from accent (ok, full) to warn (≥80% of RAW) to
 * danger (≥ RAW, empty) as the bucket drains. The notch holds steady at the
 * irrigation-trigger mark while the fill recedes; both width and tone tween
 * over 360ms.
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

    const animated = useRef(new Animated.Value(geometry.fillPct / 100)).current;
    const toneAnimated = useRef(new Animated.Value(toneIndex(geometry.tone))).current;

    useEffect(() => {
        Animated.timing(animated, {
            toValue: geometry.fillPct / 100,
            duration: Duration.slow,
            useNativeDriver: false,
        }).start();
    }, [animated, geometry.fillPct]);

    useEffect(() => {
        Animated.timing(toneAnimated, {
            toValue: toneIndex(geometry.tone),
            duration: Duration.slow,
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

    const held = Math.max(0, raw - depletion);
    const derivedLabel = accessibilityLabel
        ?? `${geometry.tone} — ${formatMm(held)} of ${formatMm(raw)} mm available`;

    return (
        <View
            accessibilityRole='progressbar'
            accessibilityLabel={derivedLabel}
            accessibilityValue={{ min: 0, max: Math.round(raw * 100) / 100, now: Math.round(held * 100) / 100 }}
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
                    left: `${geometry.notchPct}%`,
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
