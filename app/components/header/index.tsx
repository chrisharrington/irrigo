import { Text, View } from 'react-native';

import { BrandGlyph } from '@/components/brand-glyph';
import { Button } from '@/components/button';
import { Menu, Refresh } from '@/components/icons';
import { FontFamily } from '@/constants/fonts';
import { useReplan } from '@/hooks/replan';
import { useSystem } from '@/hooks/system';
import config from '@/tailwind.config';

const colors = config.theme.extend.colors;

/**
 * Props for the Irrigo app header.
 */
export type HeaderProps = {
    /**
     * Required. Fired when the hamburger button is tapped (and irrigation is
     * on). The header itself is drawer-agnostic — APP-23 wires this prop to
     * the nav drawer's open handler.
     */
    onMenuPress: () => void;
};

/**
 * The shared app header — hamburger on the left, `BrandGlyph` + `Irrigo`
 * wordmark in the centre, refresh icon on the right. RN port of the App
 * header block in [`Mobile.jsx:32-68`](app/design/irrigo/project/ui_kit/Mobile.jsx).
 *
 * Reads the master irrigation switch via `useSystem`. When the system is off
 * (or the query hasn't resolved yet — sticky-off during cold start), both
 * icon buttons disable and the centre brand row dims to 0.45 opacity. The
 * design source uses `filter: grayscale(1)` to desaturate the brand, but
 * React Native has no CSS filter; opacity is the portable approximation.
 *
 * The refresh button dispatches `useReplan` and stays disabled while a
 * re-plan is in flight so impatient double-taps don't queue duplicate
 * mutations.
 */
export function Header({ onMenuPress }: HeaderProps) {
    const { data: system } = useSystem();
    const replan = useReplan();
    const irrigationOn = system?.irrigationEnabled === true;
    const refreshDisabled = !irrigationOn || replan.isPending;

    return (
        <View className='flex-row items-center justify-between gap-3 px-4 pt-1 pb-[14px]'>
            <Button
                iconOnly
                variant='ghost'
                accessibilityLabel='Open menu'
                disabled={!irrigationOn}
                onPress={onMenuPress}
            >
                <Menu size={18} />
            </Button>
            <View
                className='flex-row items-center gap-2'
                style={{ opacity: irrigationOn ? 1 : 0.45 }}
            >
                <BrandGlyph size={24} />
                <Text
                    style={{
                        fontFamily: FontFamily.displaySemibold,
                        fontSize: 16,
                        lineHeight: 16,
                        letterSpacing: -0.32,
                        color: colors.fg,
                    }}
                >
                    Irrigo
                </Text>
            </View>
            <Button
                iconOnly
                variant='ghost'
                accessibilityLabel='Re-plan'
                disabled={refreshDisabled}
                onPress={() => replan.mutate()}
            >
                <Refresh size={16} />
            </Button>
        </View>
    );
}
