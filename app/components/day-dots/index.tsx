import { StyleSheet, View } from 'react-native';

import config from '@/tailwind.config';

const colors = config.theme.extend.colors;

/**
 * Props for the compact 7-dot day preview.
 */
export type DayDotsProps = {
    /** Required. Booleans for Mon-Sun (index 0 = Mon). */
    days: ReadonlyArray<boolean>;

    /** Optional. Side length of each square dot in pixels. Defaults to 6. */
    size?: number;

    /** Optional. Gap between dots in pixels. Defaults to 3. */
    gap?: number;
};

/**
 * Minimal seven-dot day preview used in the "other profiles" rows. Accent
 * fill for active days, dimmed `ink-500` for inactive ones. RN port of
 * `DayDots` from the design source's `Mobile.jsx`.
 */
export function DayDots({ days, size = 6, gap = 3 }: DayDotsProps) {
    return (
        <View style={{ flexDirection: 'row', gap }}>
            {days.map((on, index) => (
                <View
                    // eslint-disable-next-line react/no-array-index-key
                    key={index}
                    style={[
                        styles.dot,
                        { width: size, height: size },
                        on ? styles.dotOn : styles.dotOff,
                    ]}
                />
            ))}
        </View>
    );
}

const styles = StyleSheet.create({
    dot: {
        // Square corners on purpose — the design uses a 1px square pip, not
        // a circle.
    },
    dotOn: {
        backgroundColor: colors.accent,
    },
    dotOff: {
        backgroundColor: colors['ink-500'],
        opacity: 0.6,
    },
});
