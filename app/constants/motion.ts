import { Easing } from 'react-native';

/**
 * Canonical animation durations, mirroring the `--d-1` / `--d-2` / `--d-3`
 * tokens defined in [`app/design/irrigo/project/colors_and_type.css`](app/design/irrigo/project/colors_and_type.css).
 * Use these for every `Animated.timing` `duration` value so the app's motion
 * feels consistent across primitives.
 */
export const Duration = {
    /** 120 ms — quick state flips (button press feedback, hover-tier color changes). */
    fast: 120,
    /** 220 ms — default for control transitions (toggle thumb, drawer slide). */
    default: 220,
    /** 360 ms — slower hero animations (battery fill, depletion tone). */
    slow: 360,
} as const;

/**
 * Canonical easing curves, mirroring `--ease-out` in the design tokens.
 * Named `MotionEasing` rather than `Easing` to avoid shadowing React Native's
 * own `Easing` export at import sites.
 */
export const MotionEasing = {
    /** `cubic-bezier(0.2, 0.7, 0.2, 1)` — the brand-canonical ease-out used by every transition in the design source. */
    standard: Easing.bezier(0.2, 0.7, 0.2, 1),
} as const;
