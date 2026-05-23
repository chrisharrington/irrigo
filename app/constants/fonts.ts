/**
 * Brand font family names — the exact identifiers registered by FontLoader's
 * `useFonts` call. React Native resolves custom fonts by family name, not by
 * family-name + weight, so each weight is its own family. Use these constants
 * in `StyleSheet` (where Tailwind `font-*` classes don't apply) so the magic
 * strings stay co-located with the tailwind config they mirror.
 */
export const FontFamily = {
    // Bricolage Grotesque — display weights.
    display: 'BricolageGrotesque_400Regular',
    displayMedium: 'BricolageGrotesque_500Medium',
    displaySemibold: 'BricolageGrotesque_600SemiBold',
    displayBold: 'BricolageGrotesque_700Bold',
    // Geist — body / UI weights.
    sansLight: 'Geist_300Light',
    sans: 'Geist_400Regular',
    sansMedium: 'Geist_500Medium',
    sansSemibold: 'Geist_600SemiBold',
    sansBold: 'Geist_700Bold',
    // Geist Mono — numeric weights.
    mono: 'GeistMono_400Regular',
    monoMedium: 'GeistMono_500Medium',
    monoSemibold: 'GeistMono_600SemiBold',
} as const;
