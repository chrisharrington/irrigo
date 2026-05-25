import { StyleSheet, Text, View } from 'react-native';

import { FontFamily } from '@/constants/fonts';
import { Drop, Pause } from '@/components/icons';
import { TileGradient } from '@/components/tile-gradient';
import { Toggle } from '@/components/toggle';
import { useSetSystemEnabled, useSystem } from '@/hooks/system';
import config from '@/tailwind.config';

const colors = config.theme.extend.colors;

/**
 * Props for the master irrigation kill-switch.
 */
export type MasterToggleProps = {
    /** Optional. Accessibility label for the card container. Defaults to `'Master irrigation kill switch'`. */
    accessibilityLabel?: string;
};

const DEFAULT_LABEL = 'Master irrigation kill switch';
const ERROR_QUERY_SUB = 'Failed to load system state.';
const ERROR_MUTATION_PREFIX = 'Last attempt failed: ';

/**
 * The master irrigation kill switch — the single control that stops all
 * scheduling and manual runs site-wide. Owns its own data: `useSystem` for
 * the current state, `useSetSystemEnabled` for the flip. Drop it into any
 * screen that needs the switch (Home hero, Settings); no props required.
 * RN port of `MasterToggle` from the design source's `Mobile.jsx`.
 */
export function MasterToggle({ accessibilityLabel = DEFAULT_LABEL }: MasterToggleProps) {
    const system = useSystem();
    const setEnabled = useSetSystemEnabled();

    if (system.isPending) return <PendingCard accessibilityLabel={accessibilityLabel} />;
    if (system.isError || system.data === undefined) {
        return <ErrorCard accessibilityLabel={accessibilityLabel} />;
    }

    const on = system.data.irrigationEnabled;
    const palette = on ? ON_PALETTE : OFF_PALETTE;

    const mutationErrorSub = setEnabled.isError
        ? `${ERROR_MUTATION_PREFIX}${setEnabled.error.message}.`
        : undefined;

    return (
        <TileGradient
            accessibilityLabel={accessibilityLabel}
            style={[styles.card, { borderColor: palette.border }]}
        >
            <View style={[styles.iconBadge, { borderColor: palette.border, backgroundColor: palette.tint }]}>
                {on
                    ? <Drop color={colors.accent} />
                    : <Pause color={colors.warn} />}
            </View>

            <View style={styles.body}>
                <Text style={[styles.eyebrow, { color: palette.accent }]}>
                    {on ? 'System on' : 'System off'}
                </Text>
                <Text style={styles.title}>
                    {on ? 'Irrigation enabled' : 'Irrigation disabled'}
                </Text>
                <Text style={styles.sub}>
                    {mutationErrorSub
                        ?? (on
                            ? 'Scheduling & manual runs allowed'
                            : 'Scheduling & manual runs blocked')}
                </Text>
            </View>

            <Toggle
                value={on}
                onValueChange={next => setEnabled.mutate(next)}
                size='lg'
                disabled={setEnabled.isPending}
                accessibilityLabel={on ? 'Disable irrigation' : 'Enable irrigation'}
            />
        </TileGradient>
    );
}

type Palette = {
    accent: string;
    border: string;
    tint: string;
};

const ON_PALETTE: Palette = {
    accent: colors.accent,
    border: colors['accent-border'],
    tint: colors['accent-tint'],
};

const OFF_PALETTE: Palette = {
    accent: colors.warn,
    border: colors['warn-border'],
    tint: colors['warn-tint'],
};

function PendingCard({ accessibilityLabel }: { accessibilityLabel: string }) {
    return (
        <TileGradient
            accessibilityLabel={accessibilityLabel}
            style={[styles.card, { borderColor: colors.border }]}
        >
            <View style={[styles.iconBadge, { borderColor: colors.border, backgroundColor: colors.surface }]}>
                <Drop color={colors['fg-muted']} />
            </View>

            <View style={styles.body}>
                <Text style={[styles.eyebrow, { color: colors['fg-muted'] }]}>Loading</Text>
                <Text style={styles.title}>System state</Text>
                <Text style={styles.sub}>Fetching irrigation status…</Text>
            </View>
        </TileGradient>
    );
}

function ErrorCard({ accessibilityLabel }: { accessibilityLabel: string }) {
    return (
        <TileGradient
            accessibilityLabel={accessibilityLabel}
            style={[styles.card, { borderColor: colors['warn-border'] }]}
        >
            <View style={[styles.iconBadge, { borderColor: colors['warn-border'], backgroundColor: colors['warn-tint'] }]}>
                <Pause color={colors.warn} />
            </View>

            <View style={styles.body}>
                <Text style={[styles.eyebrow, { color: colors.warn }]}>System unreachable</Text>
                <Text style={styles.title}>Status unknown</Text>
                <Text style={styles.sub}>{ERROR_QUERY_SUB}</Text>
            </View>
        </TileGradient>
    );
}

const styles = StyleSheet.create({
    card: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        padding: 14,
        borderWidth: 1,
        borderRadius: 4,
    },
    iconBadge: {
        width: 36,
        height: 36,
        flexShrink: 0,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderRadius: 4,
    },
    body: {
        flex: 1,
        minWidth: 0,
        gap: 4,
    },
    eyebrow: {
        fontFamily: FontFamily.sansMedium,
        fontSize: 10,
        lineHeight: 12,
        letterSpacing: 1.6,
        textTransform: 'uppercase',
    },
    title: {
        fontFamily: FontFamily.displaySemibold,
        fontSize: 17,
        lineHeight: 19,
        color: colors.fg,
    },
    sub: {
        fontFamily: FontFamily.monoMedium,
        fontSize: 11,
        lineHeight: 14,
        color: colors['fg-muted'],
    },
});
