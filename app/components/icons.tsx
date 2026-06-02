import Svg, { Circle, Path, Rect } from 'react-native-svg';

/**
 * Shared shape for every icon in the Irrigo icon set. Mirrors the design
 * source's Lucide-style recipe: 16×16 viewBox, stroke-based geometry with
 * an optional 1.4–1.6 stroke width, all coloring controlled via props
 * (no CSS `currentColor` — React Native doesn't propagate it).
 */
export type IconProps = {
    /** Optional. Pixel size for the rendered square. Defaults to 16. */
    size?: number;

    /** Optional. Stroke or fill color. Defaults to the `fg` token hex (`#ECF1ED`). */
    color?: string;

    /** Optional. Override stroke width on stroke-based icons. Ignored by fill-based icons (`More`, `Play`). */
    strokeWidth?: number;

    /** Optional. Accessibility label exposed to assistive tech. Omit for decorative icons paired with text. */
    accessibilityLabel?: string;
};

const DEFAULT_COLOR = '#ECF1ED';
const DEFAULT_SIZE = 16;

export function Drop({ size = DEFAULT_SIZE, color = DEFAULT_COLOR, strokeWidth = 1.4, accessibilityLabel }: IconProps) {
    return (
        <Svg width={size} height={size} viewBox='0 0 16 16' fill='none' stroke={color} strokeWidth={strokeWidth} strokeLinejoin='round' accessibilityLabel={accessibilityLabel}>
            <Path d='M8 1.5 C 4 6, 3 9, 3 11 a 5 5 0 0 0 10 0 C 13 9, 12 6, 8 1.5 Z' />
        </Svg>
    );
}

export function ChevR({ size = DEFAULT_SIZE, color = DEFAULT_COLOR, strokeWidth = 1.6, accessibilityLabel }: IconProps) {
    return (
        <Svg width={size} height={size} viewBox='0 0 16 16' fill='none' stroke={color} strokeWidth={strokeWidth} strokeLinecap='round' strokeLinejoin='round' accessibilityLabel={accessibilityLabel}>
            <Path d='M6 3 l 5 5 l -5 5' />
        </Svg>
    );
}

export function ChevL({ size = DEFAULT_SIZE, color = DEFAULT_COLOR, strokeWidth = 1.6, accessibilityLabel }: IconProps) {
    return (
        <Svg width={size} height={size} viewBox='0 0 16 16' fill='none' stroke={color} strokeWidth={strokeWidth} strokeLinecap='round' strokeLinejoin='round' accessibilityLabel={accessibilityLabel}>
            <Path d='M10 3 l -5 5 l 5 5' />
        </Svg>
    );
}

export function Refresh({ size = DEFAULT_SIZE, color = DEFAULT_COLOR, strokeWidth = 1.4, accessibilityLabel }: IconProps) {
    return (
        <Svg width={size} height={size} viewBox='0 0 16 16' fill='none' stroke={color} strokeWidth={strokeWidth} strokeLinecap='round' strokeLinejoin='round' accessibilityLabel={accessibilityLabel}>
            <Path d='M13 8 a 5 5 0 1 1 -1.5 -3.5 M13 2 v 3 h -3' />
        </Svg>
    );
}

export function Bell({ size = DEFAULT_SIZE, color = DEFAULT_COLOR, strokeWidth = 1.4, accessibilityLabel }: IconProps) {
    return (
        <Svg width={size} height={size} viewBox='0 0 16 16' fill='none' stroke={color} strokeWidth={strokeWidth} strokeLinecap='round' strokeLinejoin='round' accessibilityLabel={accessibilityLabel}>
            <Path d='M4 11 V 7 a 4 4 0 0 1 8 0 v 4 M3 11 h 10 M6.5 13 a 1.5 1.5 0 0 0 3 0' />
        </Svg>
    );
}

export function More({ size = DEFAULT_SIZE, color = DEFAULT_COLOR, accessibilityLabel }: IconProps) {
    return (
        <Svg width={size} height={size} viewBox='0 0 16 16' fill={color} accessibilityLabel={accessibilityLabel}>
            <Circle cx={3} cy={8} r={1} />
            <Circle cx={8} cy={8} r={1} />
            <Circle cx={13} cy={8} r={1} />
        </Svg>
    );
}

export function Play({ size = DEFAULT_SIZE, color = DEFAULT_COLOR, accessibilityLabel }: IconProps) {
    return (
        <Svg width={size} height={size} viewBox='0 0 16 16' fill={color} accessibilityLabel={accessibilityLabel}>
            <Path d='M4 3 L 13 8 L 4 13 Z' />
        </Svg>
    );
}

export function Pause({ size = DEFAULT_SIZE, color = DEFAULT_COLOR, accessibilityLabel }: IconProps) {
    return (
        <Svg width={size} height={size} viewBox='0 0 16 16' fill={color} accessibilityLabel={accessibilityLabel}>
            <Rect x={4} y={3} width={2.5} height={10} rx={0.5} />
            <Rect x={9.5} y={3} width={2.5} height={10} rx={0.5} />
        </Svg>
    );
}

export function Zone({ size = DEFAULT_SIZE, color = DEFAULT_COLOR, strokeWidth = 1.4, accessibilityLabel }: IconProps) {
    return (
        <Svg width={size} height={size} viewBox='0 0 16 16' fill='none' stroke={color} strokeWidth={strokeWidth} strokeLinejoin='round' accessibilityLabel={accessibilityLabel}>
            <Path d='M3 4 C 4 2, 12 2, 13 5 C 14 8, 12 12, 8 13 C 4 13, 2 9, 3 4 Z' />
        </Svg>
    );
}

export function Cal({ size = DEFAULT_SIZE, color = DEFAULT_COLOR, strokeWidth = 1.4, accessibilityLabel }: IconProps) {
    return (
        <Svg width={size} height={size} viewBox='0 0 16 16' fill='none' stroke={color} strokeWidth={strokeWidth} strokeLinecap='round' accessibilityLabel={accessibilityLabel}>
            <Rect x={2.5} y={3.5} width={11} height={10} rx={1.5} />
            <Path d='M2.5 6 H 13.5 M5 2 v 3 M11 2 v 3' />
        </Svg>
    );
}

export function History({ size = DEFAULT_SIZE, color = DEFAULT_COLOR, strokeWidth = 1.4, accessibilityLabel }: IconProps) {
    return (
        <Svg width={size} height={size} viewBox='0 0 16 16' fill='none' stroke={color} strokeWidth={strokeWidth} strokeLinecap='round' strokeLinejoin='round' accessibilityLabel={accessibilityLabel}>
            <Path d='M2 8 a 6 6 0 1 0 2 -4.3 M2 3 v 3 h 3 M8 5 v 3 l 2 1.5' />
        </Svg>
    );
}

export function Home({ size = DEFAULT_SIZE, color = DEFAULT_COLOR, strokeWidth = 1.4, accessibilityLabel }: IconProps) {
    return (
        <Svg width={size} height={size} viewBox='0 0 16 16' fill='none' stroke={color} strokeWidth={strokeWidth} strokeLinejoin='round' accessibilityLabel={accessibilityLabel}>
            <Path d='M2.5 7.5 L 8 3 L 13.5 7.5 V 13 H 2.5 Z' />
        </Svg>
    );
}

export function Menu({ size = DEFAULT_SIZE, color = DEFAULT_COLOR, strokeWidth = 1.6, accessibilityLabel }: IconProps) {
    return (
        <Svg width={size} height={size} viewBox='0 0 16 16' fill='none' stroke={color} strokeWidth={strokeWidth} strokeLinecap='round' accessibilityLabel={accessibilityLabel}>
            <Path d='M2.5 4.5 H 13.5 M2.5 8 H 13.5 M2.5 11.5 H 9.5' />
        </Svg>
    );
}

export function X({ size = DEFAULT_SIZE, color = DEFAULT_COLOR, strokeWidth = 1.6, accessibilityLabel }: IconProps) {
    return (
        <Svg width={size} height={size} viewBox='0 0 16 16' fill='none' stroke={color} strokeWidth={strokeWidth} strokeLinecap='round' accessibilityLabel={accessibilityLabel}>
            <Path d='M4 4 L 12 12 M12 4 L 4 12' />
        </Svg>
    );
}

export function Check({ size = DEFAULT_SIZE, color = DEFAULT_COLOR, strokeWidth = 1.6, accessibilityLabel }: IconProps) {
    return (
        <Svg width={size} height={size} viewBox='0 0 16 16' fill='none' stroke={color} strokeWidth={strokeWidth} strokeLinecap='round' strokeLinejoin='round' accessibilityLabel={accessibilityLabel}>
            <Path d='M3 8.5 l 3 3 l 7 -7' />
        </Svg>
    );
}

export function Help({ size = DEFAULT_SIZE, color = DEFAULT_COLOR, strokeWidth = 1.4, accessibilityLabel }: IconProps) {
    return (
        <Svg width={size} height={size} viewBox='0 0 16 16' fill='none' stroke={color} strokeWidth={strokeWidth} strokeLinecap='round' strokeLinejoin='round' accessibilityLabel={accessibilityLabel}>
            <Circle cx='8' cy='8' r='6.5' />
            <Path d='M6.06 6 a 2 2 0 0 1 3.89 0.67 c 0 1.33 -2 2 -2 2' />
            <Path d='M8 11.3 h 0.01' />
        </Svg>
    );
}
