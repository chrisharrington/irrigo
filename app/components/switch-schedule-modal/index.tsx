import { StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/button';
import { Modal } from '@/components/modal';
import { FontFamily } from '@/constants/fonts';
import type { ScheduleListItem } from '@/api/types/schedules';
import config from '@/tailwind.config';

const colors = config.theme.extend.colors;

/**
 * Props for the switch-schedule confirmation modal.
 */
export type SwitchScheduleModalProps = {
    /** Required. The schedule to switch to. `null` keeps the modal hidden. */
    schedule: ScheduleListItem | null;

    /** Required. Fires when the user taps Cancel or the backdrop. */
    onCancel: () => void;

    /** Required. Fires when the user confirms the switch. */
    onConfirm: () => void;

    /** Optional. Disables the confirm button while the switch mutation is in flight. */
    isSubmitting?: boolean;
};

/**
 * Confirmation sheet for switching the active irrigation profile. Wraps
 * the generic Modal primitive in its `bottom-sheet` variant (slides up from
 * the bottom) with the switch-flow copy. The server always re-plans on
 * schedule enable, so the action label is "Switch & re-plan" and the body
 * explains the implication. RN port of `SwitchModal` from `Mobile.jsx`.
 */
export function SwitchScheduleModal({
    schedule,
    onCancel,
    onConfirm,
    isSubmitting = false,
}: SwitchScheduleModalProps) {
    const name = schedule?.name ?? '';

    return (
        <Modal
            visible={schedule !== null}
            onRequestClose={onCancel}
            variant='bottom-sheet'
            accessibilityLabel={schedule !== null ? `Switch to ${name}?` : undefined}
        >
            <View style={styles.header}>
                <Text style={styles.title}>Switch to {name}?</Text>
                <Text style={styles.sub}>Active schedule will be replaced. A re-plan will run immediately.</Text>
            </View>

            <View style={styles.footer}>
                <View style={styles.footerSlot}>
                    <Button variant='ghost' onPress={onCancel}>Cancel</Button>
                </View>
                <View style={styles.footerSlot}>
                    <Button variant='primary' onPress={onConfirm} disabled={isSubmitting}>
                        Switch & re-plan
                    </Button>
                </View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    header: {
        paddingHorizontal: 22,
        paddingTop: 20,
        paddingBottom: 16,
        gap: 4,
    },
    title: {
        fontFamily: FontFamily.displaySemibold,
        fontSize: 22,
        lineHeight: 26,
        letterSpacing: -0.22,
        color: colors.fg,
    },
    sub: {
        fontFamily: FontFamily.sans,
        fontSize: 12,
        lineHeight: 17,
        color: colors['fg-muted'],
    },
    footer: {
        flexDirection: 'row',
        gap: 8,
        paddingHorizontal: 18,
        paddingTop: 14,
        paddingBottom: 18,
        borderTopWidth: 1,
        borderTopColor: colors.hairline,
        marginTop: 6,
    },
    footerSlot: {
        flex: 1,
    },
});
