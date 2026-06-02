import { Fragment } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { NotificationSettingsDto } from '@/api/types/settings';
import { Card } from '@/components/card';
import { Toggle } from '@/components/toggle';
import { FontFamily } from '@/constants/fonts';
import { useNotificationSettings, useUpdateNotificationSettings } from '@/hooks/settings';
import config from '@/tailwind.config';

const colors = config.theme.extend.colors;

/**
 * The five notification toggles in display order. `field` is the
 * `NotificationSettingsDto` key PATCHed back; `label` is the visible row text
 * (and the toggle's accessibility label); `description` is the muted subtitle.
 */
const ROWS: ReadonlyArray<{ field: keyof NotificationSettingsDto; label: string; description: string }> = [
    { field: 'scheduleStart', label: 'Schedule started', description: `When a night's irrigation run begins.` },
    { field: 'scheduleEnd', label: 'Schedule ended', description: `When a night's irrigation run finishes.` },
    { field: 'wateringStart', label: 'Watering started', description: 'When an individual zone starts watering.' },
    { field: 'wateringEnd', label: 'Watering ended', description: 'When an individual zone stops watering.' },
    { field: 'error', label: 'Errors', description: 'When something goes wrong during a run.' },
];

/**
 * Smart container for the Settings screen. Reads the notification toggles via
 * `useNotificationSettings()` and PATCHes each flag back the moment its toggle
 * flips (`useUpdateNotificationSettings()` applies the change optimistically,
 * so the thumb moves instantly). Drop-in for any screen route — the caller
 * wraps it in its own scroll container.
 */
export function NotificationSettingsView() {
    const settings = useNotificationSettings();
    const update = useUpdateNotificationSettings();

    if (settings.isPending) {
        return (
            <View style={styles.container}>
                <Text style={styles.eyebrow}>Preferences · loading</Text>
                <Text style={styles.title}>Settings</Text>
                <Text style={styles.placeholder}>Fetching notification settings…</Text>
            </View>
        );
    }

    if (settings.isError || settings.data === undefined) {
        return (
            <View style={styles.container}>
                <Text style={styles.eyebrow}>Preferences · unavailable</Text>
                <Text style={styles.title}>Settings</Text>
                <Text style={styles.errorText}>Failed to load notification settings.</Text>
            </View>
        );
    }

    const values = settings.data;

    return (
        <View style={styles.container}>
            <Text style={styles.eyebrow}>Preferences · notifications</Text>
            <Text style={styles.title}>Settings</Text>

            <Card>
                <Text style={styles.cardHeading}>Notifications</Text>
                {ROWS.map((row, index) => (
                    <Fragment key={row.field}>
                        {index > 0 && <View style={styles.divider} />}
                        <View style={styles.row}>
                            <View style={styles.rowText}>
                                <Text style={styles.rowLabel}>{row.label}</Text>
                                <Text style={styles.rowDescription}>{row.description}</Text>
                            </View>
                            <Toggle
                                value={values[row.field]}
                                onValueChange={next => update.mutate({ [row.field]: next })}
                                accessibilityLabel={row.label}
                            />
                        </View>
                    </Fragment>
                ))}
            </Card>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        gap: 18,
        paddingHorizontal: 20,
    },
    eyebrow: {
        fontFamily: FontFamily.sansMedium,
        fontSize: 11,
        lineHeight: 13,
        letterSpacing: 1.54,
        color: colors['fg-muted'],
        textTransform: 'uppercase',
    },
    title: {
        fontFamily: FontFamily.displayBold,
        fontSize: 28,
        lineHeight: 28,
        letterSpacing: -0.7,
        color: colors.fg,
    },
    placeholder: {
        fontFamily: FontFamily.sans,
        fontSize: 14,
        lineHeight: 20,
        color: colors['fg-muted'],
    },
    errorText: {
        fontFamily: FontFamily.sans,
        fontSize: 14,
        lineHeight: 20,
        color: colors.warn,
    },
    cardHeading: {
        fontFamily: FontFamily.sansSemibold,
        fontSize: 11,
        lineHeight: 11,
        letterSpacing: 1.54,
        color: colors.accent,
        textTransform: 'uppercase',
        marginBottom: 4,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
        paddingVertical: 12,
    },
    rowText: {
        flex: 1,
        gap: 2,
    },
    rowLabel: {
        fontFamily: FontFamily.sansMedium,
        fontSize: 15,
        lineHeight: 18,
        color: colors.fg,
    },
    rowDescription: {
        fontFamily: FontFamily.sans,
        fontSize: 12,
        lineHeight: 16,
        color: colors['fg-muted'],
    },
    divider: {
        height: 1,
        backgroundColor: colors.border,
    },
});
