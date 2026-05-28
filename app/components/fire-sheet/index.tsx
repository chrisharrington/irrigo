import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import type { ZoneSummary } from '@/api/types/zones';
import { Button } from '@/components/button';
import { Sheet } from '@/components/sheet';
import { FontFamily } from '@/constants/fonts';
import config from '@/tailwind.config';

const colors = config.theme.extend.colors;

const MIN_MINUTES = 1;
const MAX_MINUTES = 60;
const DEFAULT_MINUTES = 5;

/**
 * Props for the manual zone-run confirmation sheet.
 */
export type FireSheetProps = {
    /** Required. Whether the sheet is visible. */
    visible: boolean;

    /** Required. The zone whose manual run is being confirmed. */
    zone: ZoneSummary;

    /** Required. Fires when the user taps Cancel or the backdrop. */
    onCancel: () => void;

    /** Required. Fires with the chosen duration (minutes) when Run now is tapped. */
    onRun: (durationMin: number) => void;

    /** Optional. Disables the Run now button while the caller's mutation is in flight. Defaults to false. */
    isSubmitting?: boolean;
};

/**
 * Bottom sheet that confirms a manual run for a zone. Header shows the zone
 * name + grass · area, body owns a 1–60 minute stepper (default 5), footer
 * splits Cancel · Run now. Re-opening (visible flips false → true) resets
 * the readout to the default so a previous opening's choice doesn't bleed
 * in. RN port of `FireSheet` from `app/design/ui_kit/Mobile.jsx`.
 */
export function FireSheet({ visible, zone, onCancel, onRun, isSubmitting = false }: FireSheetProps) {
    const [minutes, setMinutes] = useState<number>(DEFAULT_MINUTES);

    useEffect(() => {
        if (visible) setMinutes(DEFAULT_MINUTES);
    }, [visible]);

    const canDecrement = minutes > MIN_MINUTES;
    const canIncrement = minutes < MAX_MINUTES;

    return (
        <Sheet
            visible={visible}
            onRequestClose={onCancel}
            accessibilityLabel={`Run ${zone.name}`}
        >
            <View style={styles.header}>
                <Text style={styles.title}>Run {zone.name}</Text>
                <Text style={styles.subtitle}>{zone.grassType.name} · {zone.areaM2} m²</Text>
            </View>

            <View style={styles.stepperCard}>
                <Text style={styles.eyebrow}>Duration</Text>
                <View style={styles.stepperRow}>
                    <Button
                        variant='secondary'
                        size='lg'
                        iconOnly
                        disabled={!canDecrement}
                        onPress={() => setMinutes(m => Math.max(MIN_MINUTES, m - 1))}
                        accessibilityLabel='Decrease minutes'
                    >
                        <MinusGlyph />
                    </Button>

                    <View style={styles.readout}>
                        <Text style={styles.readoutValue}>{minutes}</Text>
                        <Text style={styles.readoutLabel}>{minutes === 1 ? 'minute' : 'minutes'}</Text>
                    </View>

                    <Button
                        variant='secondary'
                        size='lg'
                        iconOnly
                        disabled={!canIncrement}
                        onPress={() => setMinutes(m => Math.min(MAX_MINUTES, m + 1))}
                        accessibilityLabel='Increase minutes'
                    >
                        <PlusGlyph />
                    </Button>
                </View>
            </View>

            <View style={styles.footer}>
                <View style={styles.footerSlot}>
                    <Button variant='secondary' onPress={onCancel}>Cancel</Button>
                </View>
                <View style={styles.footerSlot}>
                    <Button
                        variant='primary'
                        onPress={() => onRun(minutes)}
                        disabled={isSubmitting}
                    >
                        Run now
                    </Button>
                </View>
            </View>
        </Sheet>
    );
}

function MinusGlyph() {
    return (
        <Svg width={16} height={16} viewBox='0 0 16 16' fill='none'>
            <Path d='M3 8 H 13' stroke={colors.fg} strokeWidth={1.75} strokeLinecap='square' />
        </Svg>
    );
}

function PlusGlyph() {
    return (
        <Svg width={16} height={16} viewBox='0 0 16 16' fill='none'>
            <Path d='M3 8 H 13 M8 3 V 13' stroke={colors.fg} strokeWidth={1.75} strokeLinecap='square' />
        </Svg>
    );
}

const styles = StyleSheet.create({
    header: {
        marginBottom: 20,
    },
    title: {
        fontFamily: FontFamily.displaySemibold,
        fontSize: 32,
        lineHeight: 34,
        letterSpacing: -0.8,
        color: colors.fg,
    },
    subtitle: {
        marginTop: 4,
        fontFamily: FontFamily.sans,
        fontSize: 13,
        lineHeight: 17,
        color: colors['fg-muted'],
    },
    stepperCard: {
        backgroundColor: colors['ink-200'],
        borderWidth: 1,
        borderColor: colors.hairline,
        borderRadius: 6,
        paddingTop: 18,
        paddingHorizontal: 14,
        paddingBottom: 16,
        marginBottom: 14,
    },
    eyebrow: {
        textAlign: 'center',
        marginBottom: 12,
        fontFamily: FontFamily.sansMedium,
        fontSize: 10,
        lineHeight: 12,
        letterSpacing: 1.4,
        textTransform: 'uppercase',
        color: colors['fg-muted'],
    },
    stepperRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
    },
    readout: {
        flex: 1,
        alignItems: 'center',
        gap: 2,
    },
    readoutValue: {
        fontFamily: FontFamily.monoMedium,
        fontSize: 56,
        lineHeight: 56,
        color: colors.fg,
    },
    readoutLabel: {
        fontFamily: FontFamily.sans,
        fontSize: 13,
        lineHeight: 17,
        color: colors['fg-muted'],
    },
    footer: {
        flexDirection: 'row',
        gap: 10,
    },
    footerSlot: {
        flex: 1,
    },
});
