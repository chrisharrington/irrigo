import { Fragment } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { ActivityDto } from '@/api/types/activity';
import { FontFamily } from '@/constants/fonts';
import { formatActivityDate } from '@/lib/relative-time';
import config from '@/tailwind.config';

const colors = config.theme.extend.colors;

/**
 * Props for the chronological fire log.
 */
export type FireLogProps = {
    /** Required. Activity rows to render, in display (descending-date) order. */
    rows: ReadonlyArray<ActivityDto>;

    /** Required. IANA timezone used to format each row's date label. */
    siteTimezone: string;
};

/**
 * Renders the Activity screen's chronological list of past irrigation
 * events. Each row carries a date label (left), an `{applied} · {duration}`
 * headline with `{before} → {after}` sub-line (middle), and a green accent
 * dot (right). RN port of `FireLog` in `Mobile.jsx`. Returns `null` when
 * `rows` is empty so the caller can render its own empty-state copy.
 */
export function FireLog({ rows, siteTimezone }: FireLogProps) {
    if (rows.length === 0) return null;

    return (
        <View style={styles.container} accessibilityLabel='Fire log'>
            {rows.map((row, index) => (
                <Fragment key={row.id}>
                    {index > 0 && <View style={styles.divider} />}
                    <FireLogRow row={row} siteTimezone={siteTimezone} />
                </Fragment>
            ))}
        </View>
    );
}

function FireLogRow({ row, siteTimezone }: { row: ActivityDto; siteTimezone: string }) {
    const date = formatActivityDate(row.date, siteTimezone);
    const headline = `${row.appliedDepthMm.toFixed(1)} mm · ${row.durationMin} min`;
    const sub = `${row.depletionBeforeMm} → ${row.depletionAfterMm} mm`;

    return (
        <View style={styles.row} accessibilityLabel={`${date}: ${headline}`}>
            <Text style={styles.date}>{date}</Text>
            <View style={styles.body}>
                <Text style={styles.headline}>{headline}</Text>
                <Text style={styles.sub}>{sub}</Text>
            </View>
            <View style={styles.dot} />
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 4,
    },
    divider: {
        height: 1,
        backgroundColor: colors.hairline,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 12,
        paddingHorizontal: 14,
    },
    date: {
        width: 64,
        fontFamily: FontFamily.monoMedium,
        fontSize: 11,
        lineHeight: 13,
        color: colors['fg-muted'],
    },
    body: {
        flex: 1,
        minWidth: 0,
        gap: 2,
    },
    headline: {
        fontFamily: FontFamily.monoMedium,
        fontSize: 14,
        lineHeight: 16,
        color: colors.fg,
    },
    sub: {
        fontFamily: FontFamily.monoMedium,
        fontSize: 11,
        lineHeight: 13,
        color: colors['fg-dim'],
    },
    dot: {
        width: 6,
        height: 6,
        borderRadius: 4,
        backgroundColor: colors.accent,
    },
});
