import { Linking, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/button';
import { FontFamily } from '@/constants/fonts';
import config from '@/tailwind.config';

const colors = config.theme.extend.colors;

/**
 * Props for the permission-denied inline note.
 */
export type PermissionDeniedNoteProps = {
    /** Required. Whether to render the note. Caller wires this to `permission.status === 'denied'`. */
    visible: boolean;
};

/**
 * Inline note shown at the top of the Activity screen when notification
 * permission is denied. One short factual sentence + a button that opens
 * the OS app-settings screen. No nag, no modal — the operator sees this
 * once on the Activity tab and decides for themselves.
 */
export function PermissionDeniedNote({ visible }: PermissionDeniedNoteProps) {
    if (!visible) return null;

    return (
        <View style={styles.container} accessibilityLabel='Notifications disabled'>
            <Text style={styles.body}>
                Enable notifications to get alerts when you&apos;re not in the app.
            </Text>
            <View style={styles.actionSlot}>
                <Button
                    variant='ghost'
                    size='sm'
                    onPress={() => {
                        Linking.openSettings().catch(err => {
                            console.warn('permission-denied-note: openSettings failed.', err);
                        });
                    }}
                >
                    Enable notifications
                </Button>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        padding: 12,
        backgroundColor: colors['warn-tint'],
        borderWidth: 1,
        borderColor: colors['warn-border'],
        borderRadius: 4,
    },
    body: {
        flex: 1,
        fontFamily: FontFamily.sans,
        fontSize: 12,
        lineHeight: 16,
        color: colors['fg-soft'],
    },
    actionSlot: {
        flexShrink: 0,
    },
});
