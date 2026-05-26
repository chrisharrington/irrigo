import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';

import { BrandGlyph } from '@/components/brand-glyph';
import { Button } from '@/components/button';
import { FontFamily } from '@/constants/fonts';
import config from '@/tailwind.config';

const colors = config.theme.extend.colors;

/**
 * Props for the app-load error view.
 */
export type ErrorViewProps = {
    /** Required. Short uppercase status label rendered above the headline (e.g. 'Connection lost'). */
    eyebrow: string;

    /** Required. Display headline (e.g. 'Controller unreachable'). */
    title: string;

    /** Required. Factual sub-line explaining the failure. */
    sub: string;

    /** Optional. Stack-trace lines rendered in the mono block; the block is omitted when undefined or empty. */
    stack?: readonly string[];

    /** Required. Drives the primary button label and the optional 'Contacting…' status line. */
    state: 'idle' | 'retrying';

    /** Required. Press handler for the primary button — serves as both retry and cancel-attempt. */
    onRetry: () => void;
};

/**
 * Full-screen error view shown by the app-load reachability gate when the
 * API can't be reached. Mirrors `app/design/ui_kit/Error.jsx`: desaturated
 * brand row at the top, hero block (eyebrow + display headline + factual
 * sub-line + optional mono stack trace), and a primary retry button pinned
 * to the bottom of the scroll content.
 *
 * Voice (per the mock's header comment): loud, terse, actionable. No
 * apology copy. Manual retry only — the operator decides when to try
 * again.
 *
 * The mock paints two soft radial `danger-tint` vignettes in the corners
 * for a "system looks wrong" cue. RN has no radial-gradient primitive and
 * the eyebrow dot + glow already carries that intent, so the wash is
 * intentionally omitted here.
 */
export function ErrorView({ eyebrow, title, sub, stack, state, onRetry }: ErrorViewProps) {
    const hasStack = stack !== undefined && stack.length > 0;
    const isRetrying = state === 'retrying';

    return (
        <View style={styles.root}>
            <View style={styles.statusBarSpacer} />

            <View style={styles.brandRow}>
                <View style={styles.brandInner}>
                    <BrandGlyph size={22} />
                    <Text style={styles.brandWordmark}>Irrigo</Text>
                </View>
            </View>

            <View style={styles.body}>
                <View style={styles.hero}>
                    <View style={styles.eyebrowRow}>
                        <View style={styles.eyebrowDot} />
                        <Text style={styles.eyebrowText}>{eyebrow}</Text>
                    </View>

                    <Text style={styles.title}>{title}</Text>

                    <Text style={styles.sub}>{sub}</Text>

                    {hasStack ? (
                        <View style={styles.stackContainer}>
                            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                                <View>
                                    {stack.map((line, i) => (
                                        <Text
                                            key={i}
                                            style={i === 0 ? styles.stackLineFirst : styles.stackLine}
                                        >
                                            {line}
                                        </Text>
                                    ))}
                                </View>
                            </ScrollView>
                        </View>
                    ) : null}
                </View>

                <View style={styles.actions}>
                    {isRetrying ? (
                        <View style={styles.retryingRow} accessibilityLabel='Contacting'>
                            <ActivityIndicator size='small' color={colors.accent} />
                            <Text style={styles.retryingText}>Contacting…</Text>
                        </View>
                    ) : null}

                    <Button variant='primary' size='lg' onPress={onRetry}>
                        {isRetrying ? 'Cancel attempt' : 'Retry connection'}
                    </Button>
                </View>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    root: {
        flex: 1,
        backgroundColor: colors.bg,
    },
    statusBarSpacer: {
        height: 60,
    },
    brandRow: {
        paddingTop: 4,
        paddingBottom: 14,
        paddingHorizontal: 20,
    },
    brandInner: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        opacity: 0.4,
    },
    brandWordmark: {
        fontFamily: FontFamily.displaySemibold,
        fontSize: 15,
        lineHeight: 15,
        letterSpacing: -0.3,
        color: colors.fg,
    },
    body: {
        flex: 1,
        paddingTop: 6,
        paddingBottom: 22,
        paddingHorizontal: 20,
    },
    hero: {
        marginTop: 12,
    },
    eyebrowRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    eyebrowDot: {
        width: 5,
        height: 5,
        backgroundColor: colors.danger,
        boxShadow: `0 0 8px ${colors.danger}`,
    },
    eyebrowText: {
        fontFamily: FontFamily.sansMedium,
        fontSize: 11,
        lineHeight: 13,
        letterSpacing: 1.98,
        textTransform: 'uppercase',
        color: colors.danger,
    },
    title: {
        marginTop: 12,
        fontFamily: FontFamily.displayBold,
        fontSize: 32,
        lineHeight: 33,
        letterSpacing: -0.8,
        color: colors.fg,
    },
    sub: {
        marginTop: 10,
        fontFamily: FontFamily.sans,
        fontSize: 14,
        lineHeight: 21,
        color: colors['fg-soft'],
    },
    stackContainer: {
        marginTop: 16,
        paddingVertical: 10,
        paddingHorizontal: 12,
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 4,
    },
    stackLine: {
        fontFamily: FontFamily.monoMedium,
        fontSize: 10.5,
        lineHeight: 16,
        color: colors['fg-dim'],
    },
    stackLineFirst: {
        fontFamily: FontFamily.monoMedium,
        fontSize: 10.5,
        lineHeight: 16,
        color: colors.danger,
    },
    actions: {
        marginTop: 'auto',
        paddingTop: 4,
        gap: 12,
    },
    retryingRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        minHeight: 16,
    },
    retryingText: {
        fontFamily: FontFamily.monoMedium,
        fontSize: 11,
        lineHeight: 13,
        color: colors.accent,
    },
});
