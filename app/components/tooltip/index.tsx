import { useCallback, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle } from 'react-native';

import { Help } from '@/components/icons';
import { Modal } from '@/components/modal';
import { FontFamily } from '@/constants/fonts';
import config from '@/tailwind.config';

const colors = config.theme.extend.colors;

/**
 * Props for the Tooltip component.
 */
export type TooltipProps = {
    /** Required. The visible label text the help trigger sits beside. */
    label: string;

    /** Required. Heading shown at the top of the slide-up sheet; also announced when the sheet opens. */
    title: string;

    /** Required. Sheet body. A single string renders one paragraph; an array renders one paragraph per entry; any other node renders as-is. */
    body: string | string[] | ReactNode;

    /** Optional. Style override for the label text, so callers can match their surrounding typography. */
    labelStyle?: StyleProp<TextStyle>;
};

/**
 * A label paired with a small `?` trigger. Tapping the trigger opens a
 * slide-up bottom sheet (the APP-94 `Modal` `bottom-sheet` variant) explaining
 * the topic with a `title` and `body`. Mobile-first, tap-to-open — not a hover
 * popover. Dismisses via the backdrop or the Android back button.
 */
export function Tooltip({ label, title, body, labelStyle }: TooltipProps) {
    const [isOpen, setOpen] = useState<boolean>(false);

    const open = useCallback(() => setOpen(true), []);
    const close = useCallback(() => setOpen(false), []);

    return (
        <View style={styles.row}>
            <Text style={[styles.label, labelStyle]}>{label}</Text>

            <Pressable
                onPress={open}
                accessibilityRole='button'
                accessibilityLabel={`What is ${label}?`}
                hitSlop={8}
                style={styles.trigger}
            >
                <Help size={13} color={colors['fg-muted']} />
            </Pressable>

            <Modal visible={isOpen} onRequestClose={close} variant='bottom-sheet' accessibilityLabel={title}>
                <View style={styles.sheet}>
                    <Text style={styles.title}>{title}</Text>
                    {renderBody(body)}
                </View>
            </Modal>
        </View>
    );
}

/**
 * Renders the sheet body. Strings become a single paragraph, string arrays
 * become one paragraph per entry, and any other node is rendered as supplied.
 *
 * @param body - The body content passed to the tooltip.
 * @returns The body element(s) to render inside the sheet.
 */
function renderBody(body: string | string[] | ReactNode): ReactNode {
    if (typeof body === 'string') {
        return <Text style={styles.body}>{body}</Text>;
    }

    if (Array.isArray(body) && body.every(item => typeof item === 'string')) {
        return (
            <View style={styles.paragraphs}>
                {(body as string[]).map((paragraph, index) => (
                    <Text key={index} style={styles.body}>{paragraph}</Text>
                ))}
            </View>
        );
    }

    return body;
}

const styles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    label: {
        fontFamily: FontFamily.sans,
        fontSize: 13,
        lineHeight: 16,
        color: colors['fg-soft'],
    },
    trigger: {
        alignItems: 'center',
        justifyContent: 'center',
    },
    sheet: {
        paddingHorizontal: 22,
        paddingTop: 20,
        paddingBottom: 8,
        gap: 10,
    },
    title: {
        fontFamily: FontFamily.displaySemibold,
        fontSize: 20,
        lineHeight: 24,
        letterSpacing: -0.2,
        color: colors.fg,
    },
    paragraphs: {
        gap: 10,
    },
    body: {
        fontFamily: FontFamily.sans,
        fontSize: 14,
        lineHeight: 21,
        color: colors['fg-soft'],
    },
});
